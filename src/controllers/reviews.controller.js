const prisma = require('../lib/prisma');

/**
 * POST /api/reviews
 * Cria uma avaliação para uma arena. Requer autenticação.
 */
async function create(req, res) {
  const { establishment_id, stars, comment, user_name } = req.body;

  if (!establishment_id || !stars) {
    return res.status(400).json({ error: 'establishment_id e stars são obrigatórios' });
  }
  const starsInt = parseInt(stars);
  if (isNaN(starsInt) || starsInt < 1 || starsInt > 5) {
    return res.status(400).json({ error: 'stars deve ser um número entre 1 e 5' });
  }

  try {
    // req.user já é o objeto do banco (injetado por authenticateClient)
    const resolvedName =
      req.user?.name ||
      user_name ||
      req.user?.email?.split('@')[0] ||
      'Anônimo';

    // Verifica se o estabelecimento existe
    const establishment = await prisma.establishment.findUnique({
      where: { id: establishment_id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Arena não encontrada' });
    }

    // Cria a avaliação
    const review = await prisma.review.create({
      data: {
        establishment_id,
        user_id:   req.user?.id ?? null,
        user_name: resolvedName,
        stars:     starsInt,
        comment:   comment?.trim() || null,
      },
    });

    // Recalcula rating e reviews_count do estabelecimento
    const agg = await prisma.review.aggregate({
      where:  { establishment_id },
      _avg:   { stars: true },
      _count: { id: true },
    });

    await prisma.establishment.update({
      where: { id: establishment_id },
      data: {
        rating:        Math.round((agg._avg.stars || 0) * 10) / 10,
        reviews_count: agg._count.id,
      },
    });

    return res.status(201).json({
      review: {
        id:         review.id,
        user_name:  review.user_name,
        stars:      review.stars,
        comment:    review.comment,
        created_at: review.created_at,
      },
    });
  } catch (err) {
    console.error('[REVIEWS/CREATE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/arenas/:id/reviews
 * Retorna as avaliações de uma arena. Público.
 */
async function listByArena(req, res) {
  const { id } = req.params;
  try {
    const reviews = await prisma.review.findMany({
      where:   { establishment_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        id:         true,
        user_name:  true,
        stars:      true,
        comment:    true,
        created_at: true,
      },
    });
    return res.json({ reviews });
  } catch (err) {
    console.error('[REVIEWS/LIST]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { create, listByArena };
