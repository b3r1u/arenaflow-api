const prisma = require('../lib/prisma');

/**
 * GET /api/arenas
 * Público — usado pelo app do cliente (arenaflow-booking).
 * Retorna todos os estabelecimentos ativos com suas quadras disponíveis.
 *
 * Query params opcionais:
 *   city    → filtra por cidade (case-insensitive)
 *   sport   → filtra por esporte (ex: vôlei)
 */
async function list(req, res) {
  const { city, sport } = req.query;

  try {
    const where = {
      active: true,
      // Só exibe arenas que têm pelo menos uma quadra ativa
      courts: { some: { active: true } },
    };

    if (city)  where.city  = { contains: city,  mode: 'insensitive' };
    if (sport) where.sports = { has: sport };

    const establishments = await prisma.establishment.findMany({
      where,
      include: {
        courts: {
          where:   { active: true },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { rating: 'desc' },
    });

    // Mapeia para o formato esperado pelo app cliente (Arena)
    const arenas = establishments.map(mapToArena);

    return res.json({ arenas });
  } catch (err) {
    console.error('[ARENAS/LIST]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar arenas' });
  }
}

/**
 * GET /api/arenas/:id
 * Retorna uma arena específica com suas quadras.
 */
async function getById(req, res) {
  try {
    const establishment = await prisma.establishment.findFirst({
      where: { id: req.params.id, active: true },
      include: {
        courts: {
          where:   { active: true },
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!establishment) {
      return res.status(404).json({ error: 'Arena não encontrada' });
    }

    return res.json({ arena: mapToArena(establishment) });
  } catch (err) {
    console.error('[ARENAS/GET]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar arena' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converte o modelo Establishment do banco para o formato Arena
 * que o app cliente (arenaflow-booking) espera.
 */
function mapToArena(est) {
  return {
    id:            est.id,
    name:          est.name,
    city:          est.city          || '',
    neighborhood:  est.neighborhood  || '',
    address:       est.address       || '',
    phone:         est.phone         || '',
    description:   est.description   || '',
    sports:        est.sports        || [],
    open_hours:    est.open_hours     || '',
    logo_color:    est.logo_color,
    logo_initials: est.logo_initials  || '',
    logo_url:      est.logo_url       || null,
    rating:        est.rating,
    reviews_count: est.reviews_count,
    price_from:    est.price_from     || 0,
    price_to:      est.price_to       || 0,
    courts:        est.courts.map(mapToCourt),
  };
}

function mapToCourt(court) {
  return {
    id:               court.id,
    arena_id:         court.establishment_id,
    name:             court.name,
    sport_type:       court.sport_type,
    status:           court.status === 'DISPONIVEL' ? 'disponível' : 'bloqueada',
    hourly_rate:      court.hourly_rate,
    mensalista_rate:  court.mensalista_rate ?? null,
    description:      court.description || '',
  };
}

module.exports = { list, getById };
