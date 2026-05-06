const prisma  = require('../lib/prisma');
const pagarme = require('../lib/pagarme.service');

/**
 * GET /api/platform/plans
 * Lista todos os planos do sistema com estatísticas de assinantes.
 */
async function list(_req, res) {
  try {
    const plans = await prisma.plan.findMany({
      orderBy:  { price: 'asc' },
      include: {
        _count: { select: { subscriptions: true } },
      },
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
 * Atualiza os campos de um plano existente.
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
 * Cria (ou recria) o plano no Pagar.me e salva o pagarme_plan_id no banco.
 * Apenas para planos pagos (price > 0).
 */
async function syncPagarme(req, res) {
  const { id } = req.params;

  try {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });

    if (plan.price === 0) {
      return res.status(400).json({ error: 'Plano gratuito não precisa de registro no Pagar.me' });
    }

    // Cria o plano no Pagar.me (recorrência mensal por cartão)
    const pagarmeResult = await pagarme.createPlan({
      name:       plan.name,
      slug:       plan.slug,
      priceCents: Math.round(plan.price * 100),
    });

    const updated = await prisma.plan.update({
      where: { id },
      data:  { pagarme_plan_id: pagarmeResult.id },
    });

    return res.json({
      plan:           updated,
      pagarme_plan_id: pagarmeResult.id,
      message:        `Plano sincronizado com Pagar.me: ${pagarmeResult.id}`,
    });
  } catch (err) {
    console.error('[PLATFORM/PLANS/SYNC]', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao sincronizar com Pagar.me' });
  }
}

module.exports = { list, create, update, syncPagarme };
