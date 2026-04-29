const prisma = require('../lib/prisma');

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

          // Calcula valid_until = 1 mês a partir de agora
          const now = new Date();
          const validUntil = new Date(now);
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
          console.log(`[WEBHOOK] charge.paid → booking ${booking.id} (payment_option=${booking.payment_option}, era ${booking.payment_status}) → ${newStatus} | paid=R$${newPaidAmount}`);
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

      // 1. Atualiza a cota para PAGO
      await prisma.bookingPaymentSplit.update({
        where: { id: split.id },
        data:  { status: 'PAGO', updated_at: new Date() },
      });

      // 2. Recalcula paid_amount do grupo
      const group      = split.group;
      const newPaid    = group.paid_amount + split.amount;
      const groupPago  = newPaid >= group.total_amount;
      const halfPago   = newPaid >= group.total_amount * 0.5;

      await prisma.bookingPaymentGroup.update({
        where: { id: group.id },
        data: {
          paid_amount: newPaid,
          status:      groupPago ? 'PAGO' : halfPago ? 'PARCIAL' : 'PENDENTE',
          updated_at:  new Date(),
        },
      });

      // 3. Atualiza status da reserva
      const booking     = group.booking;
      let bookingStatus = booking.payment_status;

      if (group.payment_type === 'SPLIT') {
        // < 50% → PENDENTE | >= 50% → PARCIAL (quadra confirmada) | 100% → PAGO
        bookingStatus = groupPago ? 'PAGO' : halfPago ? 'PARCIAL' : 'PENDENTE';
      } else {
        // DEPOSIT — sinal pago
        bookingStatus = 'SINAL_PAGO';
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          payment_status: bookingStatus,
          paid_amount:    newPaid / 100, // converte centavos → reais
          updated_at:     new Date(),
        },
      });

      console.log(`[WEBHOOK] Split ${split.id} (${split.player_name}) → PAGO | Reserva ${booking.id} → ${bookingStatus}`);
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

    // Outros eventos — apenas loga
    console.log('[WEBHOOK] Evento ignorado:', type);

  } catch (err) {
    // Nunca retorna erro ao Pagar.me (já respondemos 200 acima)
    console.error('[WEBHOOK] Erro interno:', err.message);
  }
}

module.exports = { pagarmeWebhook };
