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

    // Auto-cria assinatura apenas para plano free ou quando não há plano escolhido
    const isNewUser = !user.subscription;
    if (isNewUser && user.role === 'ADMIN') {
      const planSlug = req.body?.plan_slug || 'free';

      // Plano pago → não cria subscription automaticamente; o frontend vai ao checkout
      if (planSlug !== 'free') {
        // Retorna sinalizando que é novo usuário com plano pago pendente de pagamento
        return res.json({ user, is_new_user: true, pending_plan: planSlug });
      }

      // Plano free → cria ACTIVE imediatamente
      const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });
      if (freePlan) {
        await prisma.subscription.create({
          data: { user_id: user.id, plan_id: freePlan.id, status: 'ACTIVE' },
        });
        user = await prisma.user.findUnique({
          where: { id: user.id },
          include: { subscription: { include: { plan: true } }, establishment: true },
        });
      }
    }

    // Calcula days_remaining no servidor para evitar dependência do relógio do cliente
    if (user.subscription?.trial_ends_at) {
      const diff = new Date(user.subscription.trial_ends_at).getTime() - Date.now();
      user.subscription.days_remaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    return res.json({ user, is_new_user: isNewUser });
  } catch (err) {
    console.error('[AUTH/ME]', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { me };
