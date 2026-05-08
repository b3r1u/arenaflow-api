const prisma  = require('../lib/prisma');
const pagarme = require('../lib/pagarme.service');

/**
 * POST /api/subscriptions
 * Cria assinatura no Pagar.me e registra no banco.
 * Body: { plan_slug, card: { number, holder_name, exp_month, exp_year, cvv }, customer_document, customer_phone }
 */
async function create(req, res) {
  const { plan_slug, card, customer_document, customer_phone, billing_address } = req.body;

  if (!plan_slug || !card?.number || !card?.holder_name || !card?.exp_month || !card?.exp_year || !card?.cvv) {
    return res.status(400).json({ error: 'Dados incompletos: plano e cartão são obrigatórios' });
  }

  try {
    // Busca plano
    const plan = await prisma.plan.findUnique({ where: { slug: plan_slug } });
    if (!plan)                 return res.status(404).json({ error: 'Plano não encontrado' });
    if (!plan.pagarme_plan_id) return res.status(400).json({ error: 'Plano ainda não sincronizado com o Pagar.me' });
    if (plan.price === 0)      return res.status(400).json({ error: 'Plano gratuito não requer assinatura' });

    // Busca usuário
    const user = await prisma.user.findUnique({
      where:   { firebase_uid: req.user.firebase_uid },
      include: { subscription: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Cria assinatura no Pagar.me
    let pagarmeResult;
    try {
      pagarmeResult = await pagarme.createSubscription({
        planId:   plan.pagarme_plan_id,
        customer: {
          name:     user.name  || card.holder_name,
          email:    user.email,
          document: customer_document || '',
          phone:    customer_phone    || '',
        },
        card,
        billingAddress: billing_address || null,
      });
    } catch (pagarmeErr) {
      console.error('[SUBSCRIPTION/CREATE] Pagar.me erro:', pagarmeErr.message);
      return res.status(422).json({ error: pagarmeErr.message || 'Erro ao processar o cartão' });
    }

    // Mapeia status do Pagar.me → nosso enum
    const statusMap = {
      active:   'ACTIVE',
      canceled: 'CANCELLED',
      past_due: 'PAST_DUE',
      inactive: 'EXPIRED',
      failed:   'PAST_DUE', // cobrança falhou — assinatura criada mas não paga
    };
    const localStatus = statusMap[pagarmeResult.status] || 'ACTIVE';

    // Se a cobrança falhou imediatamente, retorna erro ao frontend
    if (pagarmeResult.status === 'failed') {
      return res.status(422).json({
        error: 'O cartão foi recusado. Verifique os dados e tente novamente, ou use outro cartão.',
      });
    }

    // Cria ou atualiza assinatura no banco
    await prisma.subscription.upsert({
      where:  { user_id: user.id },
      update: {
        plan_id:                 plan.id,
        status:                  localStatus,
        pagarme_subscription_id: pagarmeResult.id,
        trial_ends_at:           null,
        updated_at:              new Date(),
      },
      create: {
        user_id:                 user.id,
        plan_id:                 plan.id,
        status:                  localStatus,
        pagarme_subscription_id: pagarmeResult.id,
      },
    });

    console.log(`[SUBSCRIPTION/CREATE] user=${user.email} plan=${plan_slug} sub=${pagarmeResult.id} status=${localStatus}`);

    return res.json({
      success:         true,
      subscription_id: pagarmeResult.id,
      status:          localStatus,
      plan:            { name: plan.name, slug: plan.slug, price: plan.price },
    });
  } catch (err) {
    console.error('[SUBSCRIPTION/CREATE]', err.message);
    return res.status(500).json({ error: 'Erro ao criar assinatura' });
  }
}

/**
 * DELETE /api/subscriptions/me
 * Cancela a assinatura do usuário logado.
 */
async function cancel(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where:   { firebase_uid: req.user.firebase_uid },
      include: { subscription: true },
    });
    if (!user?.subscription)                        return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (!user.subscription.pagarme_subscription_id) return res.status(400).json({ error: 'Assinatura sem ID Pagar.me para cancelar' });

    await pagarme.cancelSubscription(user.subscription.pagarme_subscription_id);

    // Rebaixa para o plano Free ao cancelar
    const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } });

    await prisma.subscription.update({
      where: { id: user.subscription.id },
      data: {
        status:     'CANCELLED',
        plan_id:    freePlan?.id ?? user.subscription.plan_id,
        updated_at: new Date(),
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[SUBSCRIPTION/CANCEL]', err.message);
    return res.status(500).json({ error: 'Erro ao cancelar assinatura' });
  }
}

module.exports = { create, cancel };
