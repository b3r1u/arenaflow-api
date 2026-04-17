const prisma = require('../lib/prisma');

// POST /api/webhook/pagarme
async function pagarmeWebhook(req, res) {
  try {
    const event = req.body;
    console.log('[PAGARME Webhook]', event?.type, JSON.stringify(event?.data?.id || ''));

    // Só processa pagamento confirmado
    if (event?.type !== 'order.paid') {
      return res.json({ received: true });
    }

    const orderId = event?.data?.id;
    if (!orderId) return res.json({ received: true });

    await prisma.booking.updateMany({
      where: { pagarme_order_id: orderId },
      data:  { payment_status: 'PAGO', updated_at: new Date() },
    });

    return res.json({ received: true });
  } catch (err) {
    console.error('[PAGARME Webhook] Erro:', err.message);
    return res.json({ received: true });
  }
}

module.exports = { pagarmeWebhook };
