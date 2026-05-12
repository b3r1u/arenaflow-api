const prisma               = require('../lib/prisma');
const { sendSupportEmail } = require('../lib/resend.service');

// POST /api/support/message
async function sendMessage(req, res, next) {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });
    }
    if (message.trim().length > 2000) {
      return res.status(400).json({ error: 'Mensagem muito longa (máx. 2000 caracteres).' });
    }

    // Busca estabelecimento (gestores) e dados completos do usuário (booking)
    const [establishment, userRow] = await Promise.all([
      prisma.establishment.findUnique({
        where:  { owner_id: req.user.id },
        select: { name: true },
      }),
      prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { name: true, phone: true },
      }),
    ]);

    const senderEmail = req.user.email || 'email não informado';
    const isBooking   = !establishment;

    await sendSupportEmail({
      establishmentName: establishment?.name || null,
      clientName:        isBooking ? (userRow?.name  || 'Cliente') : null,
      clientPhone:       isBooking ? (userRow?.phone || null)      : null,
      senderEmail,
      message: message.trim(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[support] sendMessage error:', err);
    next(err);
  }
}

module.exports = { sendMessage };
