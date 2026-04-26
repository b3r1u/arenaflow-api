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

    // Outros eventos — apenas loga
    console.log('[WEBHOOK] Evento ignorado:', type);

  } catch (err) {
    // Nunca retorna erro ao Pagar.me (já respondemos 200 acima)
    console.error('[WEBHOOK] Erro interno:', err.message);
  }
}

module.exports = { pagarmeWebhook };
