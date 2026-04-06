const admin  = require('../config/firebase');
const prisma = require('../lib/prisma');

/**
 * POST /api/auth/me
 *
 * Chamado logo após o login no front-end.
 * - Se o usuário não existe no banco → cria (primeiro acesso)
 * - Se já existe → retorna o registro atualizado
 *
 * Body: { role: 'ADMIN' | 'CLIENT' }  (opcional — usado só no primeiro acesso)
 */
async function me(req, res) {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    let user = await prisma.user.findUnique({
      where: { firebase_uid: decoded.uid },
      include: {
        subscription: { include: { plan: true } },
        establishment: true,
      },
    });

    // Primeiro acesso: cria o usuário
    if (!user) {
      const roleRequested = req.body?.role === 'ADMIN' ? 'ADMIN' : 'CLIENT';

      user = await prisma.user.create({
        data: {
          firebase_uid: decoded.uid,
          email:        decoded.email || '',
          name:         decoded.name  || null,
          role:         roleRequested,
        },
        include: {
          subscription: { include: { plan: true } },
          establishment: true,
        },
      });
    }

    return res.json({ user });
  } catch (err) {
    console.error('[AUTH/ME]', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { me };
