const prisma = require('../lib/prisma');

/**
 * GET /api/plans
 * Retorna todos os planos disponíveis (público).
 */
async function list(_req, res) {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { price: 'asc' },
    });
    return res.json({ plans });
  } catch (err) {
    console.error('[PLANS/LIST]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar planos' });
  }
}

/**
 * POST /api/plans/trial
 * Inicia o período de teste de 7 dias para o usuário autenticado (ADMIN).
 * Só pode ser chamado uma vez — se já tiver assinatura, retorna erro.
 */
async function startTrial(req, res) {
  const userId = req.user.id;

  try {
    // Verifica se já tem assinatura
    const existing = await prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      return res.status(409).json({ error: 'Usuário já possui uma assinatura ativa' });
    }

    // Busca o plano "pro" para o trial (acesso completo durante o teste)
    const plan = await prisma.plan.findUnique({ where: { slug: 'pro' } });

    if (!plan) {
      return res.status(500).json({ error: 'Plano de trial não encontrado. Execute o seed.' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    const subscription = await prisma.subscription.create({
      data: {
        user_id:       userId,
        plan_id:       plan.id,
        status:        'TRIAL',
        trial_ends_at: trialEndsAt,
      },
      include: { plan: true },
    });

    return res.status(201).json({ subscription });
  } catch (err) {
    console.error('[PLANS/TRIAL]', err.message);
    return res.status(500).json({ error: 'Erro ao iniciar trial' });
  }
}

/**
 * GET /api/plans/my-subscription
 * Retorna a assinatura do usuário autenticado.
 */
async function mySubscription(req, res) {
  try {
    const subscription = await prisma.subscription.findUnique({
      where:   { user_id: req.user.id },
      include: { plan: true },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura encontrada' });
    }

    // Verifica se o trial expirou e atualiza o status
    if (
      subscription.status === 'TRIAL' &&
      subscription.trial_ends_at &&
      new Date() > subscription.trial_ends_at
    ) {
      const updated = await prisma.subscription.update({
        where:   { id: subscription.id },
        data:    { status: 'EXPIRED' },
        include: { plan: true },
      });
      return res.json({ subscription: updated });
    }

    return res.json({ subscription });
  } catch (err) {
    console.error('[PLANS/MY-SUBSCRIPTION]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar assinatura' });
  }
}

module.exports = { list, startTrial, mySubscription };
