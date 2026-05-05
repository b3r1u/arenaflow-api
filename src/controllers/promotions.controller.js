const prisma = require('../lib/prisma');

/** Retorna o establishment_id do usuário autenticado */
async function getEstId(userId) {
  const est = await prisma.establishment.findUnique({ where: { owner_id: userId }, select: { id: true } });
  if (!est) throw new Error('Estabelecimento não encontrado');
  return est.id;
}

/**
 * GET /api/admin/promotions
 * Lista todas as promoções do estabelecimento autenticado.
 */
async function list(req, res) {
  try {
    const estId = await getEstId(req.user.id);
    const promotions = await prisma.promotion.findMany({
      where: { establishment_id: estId },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ promotions });
  } catch (err) {
    console.error('[PROMOTIONS/LIST]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar promoções' });
  }
}

/**
 * POST /api/admin/promotions
 * Cria uma nova promoção.
 */
async function create(req, res) {
  const { title, description, type, discount_percent, start_date, end_date, start_hour, end_hour, active } = req.body;

  if (!title || !start_date) {
    return res.status(400).json({ error: 'Título e data de início são obrigatórios' });
  }

  try {
    const estId = await getEstId(req.user.id);
    const promotion = await prisma.promotion.create({
      data: {
        establishment_id: estId,
        title,
        description:      description  || null,
        type:             type         || 'DESCONTO',
        discount_percent: discount_percent ? Number(discount_percent) : null,
        start_date,
        end_date:         end_date     || null,
        start_hour:       start_hour   || null,
        end_hour:         end_hour     || null,
        active:           active !== undefined ? Boolean(active) : true,
      },
    });
    return res.status(201).json({ promotion });
  } catch (err) {
    console.error('[PROMOTIONS/CREATE]', err.message);
    return res.status(500).json({ error: 'Erro ao criar promoção' });
  }
}

/**
 * PUT /api/admin/promotions/:id
 * Atualiza uma promoção existente.
 */
async function update(req, res) {
  const { id } = req.params;
  const { title, description, type, discount_percent, start_date, end_date, start_hour, end_hour, active } = req.body;

  try {
    const estId = await getEstId(req.user.id);
    const existing = await prisma.promotion.findFirst({ where: { id, establishment_id: estId } });
    if (!existing) return res.status(404).json({ error: 'Promoção não encontrada' });

    const promotion = await prisma.promotion.update({
      where: { id },
      data: {
        title:            title            ?? existing.title,
        description:      description      !== undefined ? (description || null) : existing.description,
        type:             type             ?? existing.type,
        discount_percent: discount_percent !== undefined ? (discount_percent ? Number(discount_percent) : null) : existing.discount_percent,
        start_date:       start_date       ?? existing.start_date,
        end_date:         end_date         !== undefined ? (end_date || null) : existing.end_date,
        start_hour:       start_hour       !== undefined ? (start_hour || null) : existing.start_hour,
        end_hour:         end_hour         !== undefined ? (end_hour || null) : existing.end_hour,
        active:           active           !== undefined ? Boolean(active) : existing.active,
      },
    });
    return res.json({ promotion });
  } catch (err) {
    console.error('[PROMOTIONS/UPDATE]', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar promoção' });
  }
}

/**
 * PATCH /api/admin/promotions/:id/toggle
 * Ativa ou desativa uma promoção.
 */
async function toggle(req, res) {
  const { id } = req.params;
  try {
    const estId = await getEstId(req.user.id);
    const existing = await prisma.promotion.findFirst({ where: { id, establishment_id: estId } });
    if (!existing) return res.status(404).json({ error: 'Promoção não encontrada' });

    const promotion = await prisma.promotion.update({
      where: { id },
      data: { active: !existing.active },
    });
    return res.json({ promotion });
  } catch (err) {
    console.error('[PROMOTIONS/TOGGLE]', err.message);
    return res.status(500).json({ error: 'Erro ao alternar status da promoção' });
  }
}

/**
 * DELETE /api/admin/promotions/:id
 * Remove uma promoção.
 */
async function remove(req, res) {
  const { id } = req.params;
  try {
    const estId = await getEstId(req.user.id);
    const existing = await prisma.promotion.findFirst({ where: { id, establishment_id: estId } });
    if (!existing) return res.status(404).json({ error: 'Promoção não encontrada' });

    await prisma.promotion.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[PROMOTIONS/DELETE]', err.message);
    return res.status(500).json({ error: 'Erro ao excluir promoção' });
  }
}

/**
 * GET /api/arenas/:arenaId/promotions  (rota pública)
 * Retorna promoções ativas de uma arena para o app cliente.
 */
async function publicList(req, res) {
  const { arenaId } = req.params;
  try {
    const today = new Date().toISOString().split('T')[0];
    const promotions = await prisma.promotion.findMany({
      where: {
        establishment_id: arenaId,
        active: true,
        OR: [
          { end_date: null },
          { end_date: { gte: today } },
        ],
      },
      orderBy: { start_date: 'asc' },
    });
    return res.json({ promotions });
  } catch (err) {
    console.error('[PROMOTIONS/PUBLIC]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar promoções' });
  }
}

module.exports = { list, create, update, toggle, remove, publicList };
