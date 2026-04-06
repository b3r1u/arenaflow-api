const admin  = require('../config/firebase');
const prisma = require('../lib/prisma');

/**
 * Verifica o Firebase ID Token enviado no header Authorization.
 * Injeta `req.user` (registro do banco) e `req.firebaseUid`.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  const token = header.split('Bearer ')[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUid = decoded.uid;

    // Busca o usuário no banco (deve existir após o primeiro login)
    const user = await prisma.user.findUnique({
      where: { firebase_uid: decoded.uid },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH]', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

/**
 * Garante que o usuário autenticado tem role ADMIN.
 * Deve ser usado após `authenticate`.
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
