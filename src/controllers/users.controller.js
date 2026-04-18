const prisma = require('../lib/prisma');

/**
 * GET /api/users/me
 * Retorna os dados do usuário logado.
 */
async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { firebase_uid: req.user.firebase_uid },
      select: { id: true, email: true, name: true, phone: true, cpf: true, role: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/users/me
 * Atualiza CPF e/ou telefone do usuário logado.
 */
async function updateMe(req, res) {
  const { cpf, phone, name } = req.body;

  try {
    const data = {};
    if (cpf  !== undefined) data.cpf   = cpf  ? cpf.replace(/\D/g, '')  : null;
    if (phone !== undefined) data.phone = phone ? phone.replace(/\D/g, '') : null;
    if (name  !== undefined) data.name  = name || null;

    const user = await prisma.user.update({
      where: { firebase_uid: req.user.firebase_uid },
      data,
      select: { id: true, email: true, name: true, phone: true, cpf: true, role: true },
    });

    return res.json({ user });
  } catch (err) {
    console.error('[USERS/UPDATE_ME]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getMe, updateMe };
