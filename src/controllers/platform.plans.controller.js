const prisma  = require('../lib/prisma');
const pagarme = require('../lib/pagarme.service');

/**
 * GET /api/platform/plans
 * Lista os planos mensais do sistema (excl. -anual — gerenciados automaticamente).
 */
async function list(_req, res) {
  try {
    const plans = await prisma.plan.findMany({
      where:   { NOT: { slug: { endsWith: '-anual' } } },
      orderBy: { price: 'asc' },
      include: { _count: { select: { subscriptions: true } } },
    });
    return res.json({ plans });
  } catch (err) {
    console.error('[PLATFORM/PLANS/LIST]', err.message);
    return res.status(500).json({ error: 'Erro ao listar planos' });
  }
}

/**
 * POST /api/platform/plans
 * Cria um novo plano no banco de dados.
 */
async function create(req, res) {
  const { slug, name, description, price, max_courts, features } = req.body;

  if (!slug || !name || price === undefined) {
    return res.status(400).json({ error: 'slug, name e price são obrigatórios' });
  }

  try {
    const existing = await prisma.plan.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({ error: `Já existe um plano com o slug "${slug}"` });
    }

    const plan = await prisma.plan.create({
      data: {
        slug,
        name,
        description:  description || null,
        price:        parseFloat(price),
        max_courts:   max_courts != null ? parseInt(max_courts) : null,
        features:     Array.isArray(features) ? features : [],
        active:       true,
      },
    });

    return res.status(201).json({ plan });
  } catch (err) {
    console.error('[PLATFORM/PLANS/CREATE]', err.message);
    return res.status(500).json({ error: 'Erro ao criar plano' });
  }
}

/**
 * PUT /api/platform/plans/:id
 * Atualiza os campos de um plano mensal existente.
 * Se o preço mudar, reflete automaticamente no plano -anual correspondente (× 0,8).
 */
async function update(req, res) {
  const { id } = req.params;
  const { name, description, price, max_courts, features, active } = req.body;

  try {
    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(name        !== undefined ? { name }                            : {}),
        ...(description !== undefined ? { description }                     : {}),
        ...(price       !== undefined ? { price: parseFloat(price) }        : {}),
        ...(max_courts  !== undefined ? { max_courts: max_courts !== null ? parseInt(max_courts) : null } : {}),
        ...(features    !== undefined ? { features: Array.isArray(features) ? features : [] } : {}),
        ...(active      !== undefined ? { active: Boolean(active) }         : {}),
      },
    });

    // Se o preço foi alterado, propaga para o plano anual correspondente (se existir)
    if (price !== undefined && !plan.slug.endsWith('-anual')) {
      const annualSlug  = `${plan.slug}-anual`;
      const annualPrice = parseFloat((parseFloat(price) * 0.8).toFixed(2));
      await prisma.plan.updateMany({
        where: { slug: annualSlug },
        data:  { price: annualPrice },
      });
    }

    return res.json({ plan });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }
    console.error('[PLATFORM/PLANS/UPDATE]', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
}

/**
 * POST /api/platform/plans/:id/sync-pagarme
 * Sincroniza o plano mensal no Pagar.me e cria/sincroniza automaticamente
 * o plano anual correspondente (preço = mensal × 0,8, intervalo = year).
 */
async function syncPagarme(req, res) {
  const { id } = req.params;

  try {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
    if (plan.price === 0) {
      return res.status(400).json({ error: 'Plano gratuito não precisa de registro no Pagar.me' });
    }
    if (plan.slug.endsWith('-anual')) {
      return res.status(400).json({ error: 'Planos anuais são sincronizados automaticamente a partir do plano mensal' });
    }

    // ── 1. Sincroniza plano mensal ──────────────────────────────────────────
    const monthlyResult = await pagarme.createPlan({
      name:          plan.name,
      slug:          plan.slug,
      priceCents:    Math.round(plan.price * 100),
      interval:      'month',
      intervalCount: 1,
    });

    const updatedMonthly = await prisma.plan.update({
      where: { id },
      data:  { pagarme_plan_id: monthlyResult.id },
    });

    // ── 2. Cria / sincroniza plano anual correspondente ────────────────────
    const annualSlug  = `${plan.slug}-anual`;
    const annualPrice = parseFloat((plan.price * 0.8).toFixed(2));       // equivalente mensal com 20% off
    const annualName  = `${plan.name} Anual`;

    // Garante que o plano anual existe no banco
    const annualPlan = await prisma.plan.upsert({
      where:  { slug: annualSlug },
      update: { price: annualPrice, name: annualName, features: plan.features, max_courts: plan.max_courts, active: plan.active },
      create: {
        slug:        annualSlug,
        name:        annualName,
        description: `${plan.description || plan.name} — cobrança anual com 20% de desconto`,
        price:       annualPrice,
        max_courts:  plan.max_courts,
        features:    plan.features,
        active:      plan.active,
        commission_pct: plan.commission_pct,
      },
    });

    // Sincroniza plano anual no Pagar.me (cobra price×12 por ano)
    const annualResult = await pagarme.createPlan({
      name:          annualName,
      slug:          annualSlug,
      priceCents:    Math.round(annualPrice * 12 * 100),
      interval:      'year',
      intervalCount: 1,
    });

    await prisma.plan.update({
      where: { id: annualPlan.id },
      data:  { pagarme_plan_id: annualResult.id },
    });

    console.log(`[SYNC] ${plan.slug} → Pagar.me ${monthlyResult.id} | ${annualSlug} → ${annualResult.id}`);

    return res.json({
      plan:            updatedMonthly,
      pagarme_plan_id: monthlyResult.id,
      message:         `Plano mensal e anual sincronizados com o Pagar.me!`,
    });
  } catch (err) {
    console.error('[PLATFORM/PLANS/SYNC]', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao sincronizar com Pagar.me' });
  }
}

/**
 * GET /api/platform/plans/:id/subscribers
 * Lista os assinantes de um plano específico.
 */
async function getSubscribers(req, res) {
  const { id } = req.params;

  try {
    const subscriptions = await prisma.subscription.findMany({
      where:   { plan_id: id },
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: {
            name:  true,
            email: true,
            establishment: {
              select: {
                name: true,
                _count: { select: { courts: true } },
              },
            },
          },
        },
      },
    });

    return res.json({ subscriptions });
  } catch (err) {
    console.error('[PLATFORM/PLANS/SUBSCRIBERS]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar assinantes' });
  }
}

module.exports = { list, create, update, syncPagarme, getSubscribers };
