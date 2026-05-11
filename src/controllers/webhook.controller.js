const prisma                              = require('../lib/prisma');
const { sendBookingConfirmationEmail }    = require('../lib/resend.service');
const { auditLog }                        = require('../lib/audit.service');

/** Busca o email do cliente pelo Firebase UID e dispara o email de confirmação */
async function notifyBookingPaid(booking, courtIncluded) {
  try {
    const user = await prisma.user.findFirst({ where: { firebase_uid: booking.user_uid } });
    if (!user?.email) return;

    // Carrega quadra + estabelecimento se não vieram no include
    const court = courtIncluded || await prisma.court.findUnique({
      where:   { id: booking.court_id },
      include: { establishment: true },
    });

    await sendBookingConfirmationEmail({
      clientEmail:  user.email,
      clientName:   booking.client_name,
      arenaName:    court?.establishment?.name || 'Arena',
      courtName:    court?.name || 'Quadra',
      date:         booking.date,
      startHour:    booking.start_hour,
      endHour:      booking.end_hour,
      totalAmount:  booking.total_amount,
    });
    console.log(`[WEBHOOK] Email de confirmação enviado para ${user.email} (booking ${booking.id})`);
  } catch (err) {
    // Nunca deixa o email quebrar o fluxo principal
    console.error('[WEBHOOK] Erro ao enviar email de confirmação:', err.message);
  }
}

/**
 * POST /api/webhook/pagarme
 * Recebe eventos do Pagar.me e atualiza o status das cotas, grupo e reserva.
 *
 * Eventos tratados:
 *  - charge.paid         → cota paga
 *  - charge.payment_failed / charge.updated → ignora (pode ser extendido)
 *  - order.paid          → fallback legado (reservas sem grupo)
 */
async function pagarmeWebhook(req, res) {
  // Responde 200 imediatamente para o Pagar.me não repetir
  res.json({ received: true });

  const event = req.body;
  const type  = event?.type;

  console.log('[WEBHOOK]', type, event?.data?.id || '');

  try {
    // ── charge.paid: cota individual paga ──────────────────────────────────
    if (type === 'charge.paid') {
      const chargeId = event?.data?.id;
      if (!chargeId) return;

      // Busca a split pelo charge_id
      const split = await prisma.bookingPaymentSplit.findFirst({
        where:   { pagarme_charge_id: chargeId },
        include: { group: { include: { booking: true } } },
      });

      if (!split) {
        // ── Verifica se é um mensalista ──────────────────────────────────────
        const mensalista = await prisma.mensalista.findFirst({
          where: { pagarme_charge_id: chargeId },
        });

        if (mensalista) {
          if (mensalista.payment_status === 'PAGO') {
            console.log('[WEBHOOK] charge.paid → mensalista já PAGO, ignorando:', mensalista.id);
            return;
          }

          const now = new Date();
          // Renovação: extende de valid_until atual se ainda está no futuro.
          // Primeiro pagamento: valid_until é null → parte de agora.
          const baseDate = mensalista.valid_until && new Date(mensalista.valid_until) > now
            ? new Date(mensalista.valid_until)
            : now;
          const validUntil = new Date(baseDate);
          validUntil.setMonth(validUntil.getMonth() + 1);

          await prisma.mensalista.update({
            where: { id: mensalista.id },
            data: {
              payment_status: 'PAGO',
              status:         'ATIVO',
              payment_date:   now,
              valid_until:    validUntil,
              updated_at:     now,
            },
          });
          console.log(`[WEBHOOK] charge.paid → mensalista ${mensalista.id} → PAGO / ATIVO até ${validUntil.toISOString()}`);
          return;
        }

        // Verifica se é um booking direto com este charge (ex: pagamento de saldo 50%→100%)
        const booking = await prisma.booking.findFirst({
          where: { pagarme_charge_id: chargeId },
        });

        if (booking) {
          if (booking.payment_status === 'PAGO') {
            console.log('[WEBHOOK] charge.paid → booking já PAGO, ignorando:', booking.id);
            return;
          }

          // Fluxo de quitação do saldo (SINAL_PAGO → PAGO): charge nova gerada pelo pay-balance
          // Fluxo de entrada 50%: primeira charge, seta SINAL_PAGO com metade do total
          const isSaldoQuitar = booking.payment_status === 'SINAL_PAGO';
          const newStatus     = isSaldoQuitar ? 'PAGO' : (booking.payment_option === '50' ? 'SINAL_PAGO' : 'PAGO');
          const newPaidAmount = isSaldoQuitar
            ? Number(booking.total_amount)
            : (booking.payment_option === '50'
                ? Number(booking.total_amount) / 2
                : Number(booking.total_amount));

          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              payment_status: newStatus,
              paid_amount:    newPaidAmount,
              updated_at:     new Date(),
            },
          });
          auditLog('booking.paid', 'webhook', booking.id, {
            charge_id: chargeId, new_status: newStatus, paid_amount: newPaidAmount,
          });
          console.log(`[WEBHOOK] charge.paid → booking ${booking.id} (payment_option=${booking.payment_option}, era ${booking.payment_status}) → ${newStatus} | paid=R$${newPaidAmount}`);
          if (newStatus === 'PAGO') notifyBookingPaid(booking, null).catch(e => console.error('[WEBHOOK] email falhou:', e.message));
          return;
        }

        console.warn('[WEBHOOK] charge.paid sem split/booking correspondente:', chargeId);
        return;
      }

      // Idempotência — ignora se já estava pago
      if (split.status === 'PAGO') {
        console.log('[WEBHOOK] Split já estava PAGO, ignorando:', split.id);
        return;
      }

      // ── Atualiza split + grupo + booking numa única transação (L1) ───────────
      const group   = split.group;
      const booking = group.booking;
      const newPaid = group.paid_amount + split.amount;
      const groupPago = newPaid >= group.total_amount;
      const halfPago  = newPaid >= group.total_amount * 0.5;

      const bookingStatus = group.payment_type === 'SPLIT'
        ? (groupPago ? 'PAGO' : halfPago ? 'PARCIAL' : 'PENDENTE')
        : 'SINAL_PAGO';

      await prisma.$transaction([
        prisma.bookingPaymentSplit.update({
          where: { id: split.id },
          data:  { status: 'PAGO', updated_at: new Date() },
        }),
        prisma.bookingPaymentGroup.update({
          where: { id: group.id },
          data: {
            paid_amount: newPaid,
            status:      groupPago ? 'PAGO' : halfPago ? 'PARCIAL' : 'PENDENTE',
            updated_at:  new Date(),
          },
        }),
        prisma.booking.update({
          where: { id: booking.id },
          data: {
            payment_status: bookingStatus,
            paid_amount:    newPaid / 100, // centavos → reais
            updated_at:     new Date(),
          },
        }),
      ]);

      auditLog('split.paid', 'webhook', split.id, {
        booking_id:     booking.id,
        player:         split.player_name,
        amount_cents:   split.amount,
        booking_status: bookingStatus,
      });

      console.log(`[WEBHOOK] Split ${split.id} (${split.player_name}) → PAGO | Reserva ${booking.id} → ${bookingStatus}`);
      if (bookingStatus === 'PAGO') {
        prisma.court.findUnique({ where: { id: booking.court_id }, include: { establishment: true } })
          .then(court => notifyBookingPaid(booking, court))
          .catch(e => console.error('[WEBHOOK] email split falhou:', e.message));
      }
      return;
    }

    // ── order.paid: fallback para reservas sem grupo (fluxo legado) ────────
    if (type === 'order.paid') {
      const orderId = event?.data?.id;
      if (!orderId) return;

      // Verifica se é uma split do novo sistema
      const split = await prisma.bookingPaymentSplit.findFirst({
        where: { pagarme_order_id: orderId },
      });

      if (split) {
        // Já será tratado via charge.paid — ignora
        return;
      }

      // Fluxo direto: busca booking pelo order_id para checar payment_option
      const booking = await prisma.booking.findFirst({
        where: { pagarme_order_id: orderId },
      });

      if (!booking) {
        console.warn('[WEBHOOK] order.paid sem booking correspondente, order:', orderId);
        return;
      }

      // Reserva 50% → entrada paga (SINAL_PAGO), ainda falta o saldo
      // Reserva 100% → pagamento completo (PAGO)
      const newStatus = booking.payment_option === '50' ? 'SINAL_PAGO' : 'PAGO';

      await prisma.booking.update({
        where: { id: booking.id },
        data:  { payment_status: newStatus, updated_at: new Date() },
      });

      console.log(`[WEBHOOK] order.paid → booking ${booking.id} (${booking.payment_option}%) → ${newStatus}`);
      if (newStatus === 'PAGO') notifyBookingPaid(booking, null).catch(e => console.error('[WEBHOOK] email falhou:', e.message));
      return;
    }

    // ── charge.refunded: estorno confirmado pelo Pagar.me ─────────────────────
    // Disparado quando cancelCharge() é processado com sucesso pelo Pagar.me.
    // NÃO confundir com charge.chargedback (contestação pelo banco/cliente).
    if (type === 'charge.refunded') {
      const chargeId = event?.data?.id;
      if (!chargeId) return;

      // Fluxo split: SplitStatus possui ESTORNADO no schema — usa diretamente.
      const split = await prisma.bookingPaymentSplit.findFirst({
        where:   { pagarme_charge_id: chargeId },
        include: { group: true },
      });

      if (split) {
        // Idempotência: só atualiza se ainda não estava ESTORNADO.
        if (split.status !== 'ESTORNADO') {
          await prisma.bookingPaymentSplit.update({
            where: { id: split.id },
            data:  { status: 'ESTORNADO', updated_at: new Date() },
          });
        }
        console.log(`[WEBHOOK] charge.refunded → split ${split.id} confirmado como ESTORNADO`);
        return;
      }

      // Fluxo direto: BookingPaymentStatus NÃO possui ESTORNADO no schema atual.
      // Usa CANCELADO como representação de "cancelado com estorno confirmado".
      // SUGESTÃO: adicionar ESTORNADO ao enum BookingPaymentStatus para distinguir
      // cancelamento sem pagamento (CANCELADO) de cancelamento com estorno (ESTORNADO).
      const booking = await prisma.booking.findFirst({
        where: { pagarme_charge_id: chargeId },
      });

      // Verifica se é um mensalista
      const mensalistaRefund = await prisma.mensalista.findFirst({
        where: { pagarme_charge_id: chargeId },
      });

      if (mensalistaRefund) {
        if (mensalistaRefund.payment_status !== 'CANCELADO') {
          await prisma.mensalista.update({
            where: { id: mensalistaRefund.id },
            data:  { payment_status: 'CANCELADO', status: 'INATIVO', updated_at: new Date() },
          });
        }
        console.log(`[WEBHOOK] charge.refunded → mensalista ${mensalistaRefund.id} → CANCELADO / INATIVO`);
        return;
      }

      if (booking) {
        // Confirma o estorno: CANCELADO → ESTORNADO (distinção semântica importante)
        if (booking.payment_status !== 'ESTORNADO') {
          await prisma.booking.update({
            where: { id: booking.id },
            data:  { payment_status: 'ESTORNADO', updated_at: new Date() },
          });
        }
        console.log(`[WEBHOOK] charge.refunded → booking ${booking.id} → ESTORNADO`);
        return;
      }

      console.warn('[WEBHOOK] charge.refunded sem booking/split correspondente:', chargeId);
      return;
    }

    // ── charge.chargedback: disputa de pagamento iniciada pelo portador ────────
    // Chargeback é diferente de refund: iniciado pelo banco/cliente sem ação nossa.
    // SUGESTÃO: adicionar status CHARGEDBACK ao enum BookingPaymentStatus e
    // SplitStatus para rastrear disputas separadamente de estornos voluntários.
    if (type === 'charge.chargedback') {
      const chargeId = event?.data?.id;
      if (!chargeId) return;

      // Verifica se é um mensalista
      const mensalistaChargeback = await prisma.mensalista.findFirst({
        where: { pagarme_charge_id: chargeId },
      });

      if (mensalistaChargeback) {
        await prisma.mensalista.update({
          where: { id: mensalistaChargeback.id },
          data:  { payment_status: 'CANCELADO', status: 'INATIVO', updated_at: new Date() },
        });
        console.log(`[WEBHOOK] charge.chargedback → mensalista ${mensalistaChargeback.id} → CANCELADO / INATIVO`);
        return;
      }

      // Tenta encontrar booking direto
      const booking = await prisma.booking.findFirst({
        where: { pagarme_charge_id: chargeId },
      });

      if (booking) {
        await prisma.booking.update({
          where: { id: booking.id },
          data:  { payment_status: 'CHARGEDBACK', updated_at: new Date() },
        });
        console.log(`[WEBHOOK] charge.chargedback → booking ${booking.id} → CHARGEDBACK`);
        return;
      }

      // Tenta encontrar split correspondente
      const split = await prisma.bookingPaymentSplit.findFirst({
        where:   { pagarme_charge_id: chargeId },
        include: { group: { include: { booking: true } } },
      });

      if (split) {
        await prisma.bookingPaymentSplit.update({
          where: { id: split.id },
          data:  { status: 'CHARGEDBACK', updated_at: new Date() },
        });
        console.log(`[WEBHOOK] charge.chargedback → split ${split.id} → CHARGEDBACK`);
        return;
      }

      console.warn('[WEBHOOK] charge.chargedback sem booking/split correspondente:', chargeId);
      return;
    }

    // ── Eventos de assinatura SaaS ───────────────────────────────────────────
    if (type === 'subscription.status_changed' || type === 'subscription.canceled' || type === 'subscription.active') {
      const subscriptionId = event?.data?.id;
      const pagarmeStatus  = event?.data?.status;
      if (!subscriptionId) return;

      const statusMap = {
        active:   'ACTIVE',
        canceled: 'CANCELLED',
        past_due: 'PAST_DUE',
        inactive: 'EXPIRED',
        failed:   'PAST_DUE',
      };
      const localStatus = statusMap[pagarmeStatus];
      if (!localStatus) {
        console.log(`[WEBHOOK] subscription status desconhecido: ${pagarmeStatus}`);
        return;
      }

      // Ao cancelar, rebaixa para o plano Free
      let extraData = {};
      if (localStatus === 'CANCELLED') {
        const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });
        if (freePlan) extraData = { plan_id: freePlan.id };
      }

      const updated = await prisma.subscription.updateMany({
        where: { pagarme_subscription_id: subscriptionId },
        data:  { status: localStatus, updated_at: new Date(), ...extraData },
      });

      console.log(`[WEBHOOK] subscription ${subscriptionId} → ${localStatus} (${updated.count} registro(s) atualizado(s))`);
      return;
    }

    // ── charge.paid para assinatura (primeiro ciclo ou renovação) ────────────
    // O Pagar.me dispara charge.paid quando a cobrança recorrente é processada.
    // Usamos para garantir que status fique ACTIVE mesmo se o webhook de subscription falhar.
    if (type === 'charge.paid') {
      const chargeId       = event?.data?.id;
      const subscriptionId = event?.data?.subscription?.id;

      if (subscriptionId && chargeId) {
        // É uma cobrança de assinatura SaaS
        const updated = await prisma.subscription.updateMany({
          where: { pagarme_subscription_id: subscriptionId },
          data:  { status: 'ACTIVE', updated_at: new Date() },
        });
        if (updated.count > 0) {
          console.log(`[WEBHOOK] charge.paid (subscription) → ${subscriptionId} → ACTIVE`);
          return;
        }
      }
    }

    // Outros eventos — apenas loga
    console.log('[WEBHOOK] Evento ignorado:', type);

  } catch (err) {
    // Nunca retorna erro ao Pagar.me (já respondemos 200 acima)
    console.error('[WEBHOOK] Erro interno:', err.message);
  }
}

module.exports = { pagarmeWebhook };
