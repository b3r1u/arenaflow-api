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
        console.warn('[WEBHOOK] charge.paid sem split correspondente:', chargeId);
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

      // Fluxo legado: atualiza booking diretamente pelo order_id
      await prisma.booking.updateMany({
        where: { pagarme_order_id: orderId },
        data:  { payment_status: 'PAGO', updated_at: new Date() },
      });

      console.log('[WEBHOOK] Reserva legada atualizada para PAGO, order:', orderId);
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

      if (booking) {
        // Idempotência: booking já deve estar CANCELADO (marcado no cancel endpoint após cancelCharge).
        // Este webhook serve como confirmação assíncrona — atualiza apenas se necessário.
        if (booking.payment_status !== 'CANCELADO') {
          await prisma.booking.update({
            where: { id: booking.id },
            data:  { payment_status: 'CANCELADO', updated_at: new Date() },
          });
        }
        console.log(`[WEBHOOK] charge.refunded → booking ${booking.id} estorno confirmado (representado como CANCELADO no schema atual)`);
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

      // Tenta encontrar booking direto
      const booking = await prisma.booking.findFirst({
        where: { pagarme_charge_id: chargeId },
      });

      if (booking) {
        // SUGESTÃO: usar status CHARGEDBACK para distinguir de CANCELADO normal.
        // Por ora usa CANCELADO — os dois fluxos têm semânticas distintas.
        await prisma.booking.update({
          where: { id: booking.id },
          data:  { payment_status: 'CANCELADO', updated_at: new Date() },
        });
        console.log(`[WEBHOOK] charge.chargedback → booking ${booking.id} → CANCELADO (chargeback — NÃO confundir com refund)`);
        return;
      }

      // Tenta encontrar split correspondente
      const split = await prisma.bookingPaymentSplit.findFirst({
        where:   { pagarme_charge_id: chargeId },
        include: { group: { include: { booking: true } } },
      });

      if (split) {
        // SUGESTÃO: adicionar status CHARGEDBACK ao enum SplitStatus.
        console.log(`[WEBHOOK] charge.chargedback → split ${split.id} | booking ${split.group.booking_id} (sem status CHARGEDBACK no schema — apenas logado)`);
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
