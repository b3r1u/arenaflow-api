const admin  = require('../config/firebase');
const prisma = require('../lib/prisma');

/**
 * Verifica o Firebase ID Token enviado no header Authorization.
 * Injeta `req.user` (registro do banco) e `req.firebaseUid`.
 */
async function authenticate(req, res, next) {
  // Firebase não configurado (desenvolvimento sem chave)
  if (!admin.apps.length) {
    return res.status(503).json({
      error: 'Autenticação indisponível — configure firebase-service-account.json',
    });
  }

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

/**
 * Igual ao authenticate, mas auto-cria o usuário como CLIENT se não existir.
 * Usado nas rotas do app booking (clientes).
 */
async function authenticateClient(req, res, next) {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Autenticação indisponível' });
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido' });
  }

  const token = header.split('Bearer ')[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUid = decoded.uid;

    let user = await prisma.user.findUnique({ where: { firebase_uid: decoded.uid } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          firebase_uid: decoded.uid,
          email:        decoded.email || `${decoded.uid}@unknown.com`,
          name:         decoded.name  || null,
          role:         'CLIENT',
        },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH CLIENT]', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { authenticate, requireAdmin, authenticateClient };
