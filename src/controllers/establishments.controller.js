const prisma = require('../lib/prisma');
const { z }  = require('zod');

const EstablishmentSchema = z.object({
  name:          z.string().min(2, 'Nome muito curto'),
  city:          z.string().optional(),
  neighborhood:  z.string().optional(),
  address:       z.string().optional(),
  phone:         z.string().optional(),
  description:   z.string().optional(),
  sports:        z.array(z.string()).optional().default([]),
  open_hours:    z.string().optional(),
  logo_color:    z.string().optional(),
  logo_initials: z.string().max(3).optional(),
  logo_url:      z.string().nullable().optional(),

  // Política de cancelamento
  cancel_policy_enabled: z.boolean().optional(),
  cancel_limit_hours:    z.number().min(0).optional(),
  cancel_fee_percent:    z.number().int().min(0).max(100).optional(),
});

/**
 * GET /api/establishments/me
 * Retorna o estabelecimento do admin autenticado.
 */
async function getMyEstablishment(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { courts: { where: { active: true }, orderBy: { created_at: 'asc' } } },
    });

    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não cadastrado ainda' });
    }

    return res.json({ establishment });
  } catch (err) {
    console.error('[ESTABLISHMENTS/ME]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar estabelecimento' });
  }
}

/**
 * POST /api/establishments
 * Cria o estabelecimento do admin autenticado.
 * Cada admin só pode ter um estabelecimento.
 */
async function create(req, res) {
  const parsed = EstablishmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const existing = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });

    if (existing) {
      return res.status(409).json({ error: 'Você já possui um estabelecimento cadastrado' });
    }

    const data = parsed.data;

    // Gera as iniciais automaticamente se não fornecido
    const initials = data.logo_initials ||
      data.name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('');

    const establishment = await prisma.establishment.create({
      data: {
        owner_id:      req.user.id,
        name:          data.name,
        city:          data.city,
        neighborhood:  data.neighborhood,
        address:       data.address,
        phone:         data.phone,
        description:   data.description,
        sports:        data.sports,
        open_hours:    data.open_hours,
        logo_color:    data.logo_color || '#22a55c',
        logo_initials: initials,
        logo_url:      data.logo_url ?? null,
      },
    });

    return res.status(201).json({ establishment });
  } catch (err) {
    console.error('[ESTABLISHMENTS/CREATE]', err.message);
    return res.status(500).json({ error: 'Erro ao criar estabelecimento' });
  }
}

/**
 * PATCH /api/establishments/me
 * Atualiza os dados do estabelecimento do admin autenticado.
 */
async function update(req, res) {
  const parsed = EstablishmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const establishment = await prisma.establishment.update({
      where: { owner_id: req.user.id },
      data:  parsed.data,
    });

    return res.json({ establishment });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }
    console.error('[ESTABLISHMENTS/UPDATE]', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar estabelecimento' });
  }
}

module.exports = { getMyEstablishment, create, update };
