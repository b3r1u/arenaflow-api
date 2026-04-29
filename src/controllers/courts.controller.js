const prisma = require('../lib/prisma');
const { z }  = require('zod');

const CourtSchema = z.object({
  name:             z.string().min(1, 'Nome obrigatório'),
  sport_type:       z.enum(['futevôlei', 'vôlei', 'beach tennis', 'ambos']),
  hourly_rate:      z.number().positive('Valor por hora deve ser maior que zero'),
  mensalista_rate:  z.number().positive('Valor mensalista deve ser maior que zero').nullable().optional(),
  description:      z.string().optional(),
  status:           z.enum(['DISPONIVEL', 'BLOQUEADA']).optional().default('DISPONIVEL'),
});

// ─── Helper: garante que a quadra pertence ao estabelecimento do admin ────────
async function getCourtOrFail(courtId, establishmentId, res) {
  const court = await prisma.court.findFirst({
    where: { id: courtId, establishment_id: establishmentId, active: true },
  });
  if (!court) {
    res.status(404).json({ error: 'Quadra não encontrada' });
    return null;
  }
  return court;
}

/**
 * GET /api/courts
 * Lista quadras do estabelecimento do admin autenticado.
 */
async function list(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    const courts = await prisma.court.findMany({
      where:   { establishment_id: establishment.id, active: true },
      orderBy: { created_at: 'asc' },
    });

    return res.json({ courts });
  } catch (err) {
    console.error('[COURTS/LIST]', err.message);
    return res.status(500).json({ error: 'Erro ao listar quadras' });
  }
}

/**
 * POST /api/courts
 * Cria uma quadra no estabelecimento do admin autenticado.
 * Valida o limite de quadras do plano.
 */
async function create(req, res) {
  const parsed = CourtSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Crie seu estabelecimento antes de adicionar quadras' });
    }

    // Verifica limite de quadras do plano
    const subscription = await prisma.subscription.findUnique({
      where:   { user_id: req.user.id },
      include: { plan: true },
    });

    if (subscription?.status === 'EXPIRED' || subscription?.status === 'CANCELLED') {
      return res.status(403).json({ error: 'Assinatura expirada. Renove para adicionar quadras.' });
    }

    const maxCourts = subscription?.plan?.max_courts ?? null;

    if (maxCourts !== null) {
      const currentCount = await prisma.court.count({
        where: { establishment_id: establishment.id, active: true },
      });
      if (currentCount >= maxCourts) {
        return res.status(403).json({
          error: `Limite de ${maxCourts} quadra(s) atingido para o plano ${subscription.plan.name}`,
        });
      }
    }

    const court = await prisma.court.create({
      data: {
        establishment_id: establishment.id,
        name:             parsed.data.name,
        sport_type:       parsed.data.sport_type,
        hourly_rate:      parsed.data.hourly_rate,
        mensalista_rate:  parsed.data.mensalista_rate ?? null,
        description:      parsed.data.description,
        status:           parsed.data.status,
      },
    });

    // Atualiza price_from/price_to do estabelecimento
    await updateEstablishmentPrices(establishment.id);

    return res.status(201).json({ court });
  } catch (err) {
    console.error('[COURTS/CREATE]', err.message);
    return res.status(500).json({ error: 'Erro ao criar quadra' });
  }
}

/**
 * PATCH /api/courts/:id
 * Atualiza uma quadra do estabelecimento do admin autenticado.
 */
async function update(req, res) {
  const parsed = CourtSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const court = await getCourtOrFail(req.params.id, establishment.id, res);
    if (!court) return;

    const updated = await prisma.court.update({
      where: { id: court.id },
      data:  parsed.data,
    });

    await updateEstablishmentPrices(establishment.id);

    return res.json({ court: updated });
  } catch (err) {
    console.error('[COURTS/UPDATE]', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar quadra' });
  }
}

/**
 * DELETE /api/courts/:id
 * Soft-delete: marca a quadra como inactive.
 */
async function remove(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const court = await getCourtOrFail(req.params.id, establishment.id, res);
    if (!court) return;

    await prisma.court.update({
      where: { id: court.id },
      data:  { active: false },
    });

    await updateEstablishmentPrices(establishment.id);

    return res.json({ message: 'Quadra removida com sucesso' });
  } catch (err) {
    console.error('[COURTS/DELETE]', err.message);
    return res.status(500).json({ error: 'Erro ao remover quadra' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateEstablishmentPrices(establishmentId) {
  const courts = await prisma.court.findMany({
    where:  { establishment_id: establishmentId, active: true },
    select: { hourly_rate: true },
  });

  if (courts.length === 0) return;

  const rates     = courts.map(c => c.hourly_rate);
  const priceFrom = Math.min(...rates);
  const priceTo   = Math.max(...rates);

  await prisma.establishment.update({
    where: { id: establishmentId },
    data:  { price_from: priceFrom, price_to: priceTo },
  });
}

module.exports = { list, create, update, remove };
