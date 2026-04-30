const prisma = require('../lib/prisma');
const { createOrder, cancelCharge } = require('../lib/pagarme.service');

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Verifica se já existe mensalista ATIVO no mesmo slot (quadra + dia + horário).
 * Um slot é conflitante quando o intervalo proposto sobrepõe um intervalo existente.
 */
async function hasConflict(courtId, dayOfWeek, startHour, endHour, excludeId = null) {
  const existing = await prisma.mensalista.findMany({
    where: {
      court_id:   courtId,
      day_of_week: dayOfWeek,
      status:     'ATIVO',
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });

  return existing.some(m => {
    // Sobrepõe se: inicio proposto < fim existente E fim proposto > inicio existente
    return startHour < m.end_hour && endHour > m.start_hour;
  });
}

/* ── Endpoints do cliente ─────────────────────────────────────────────────── */

/**
 * POST /api/mensalistas
 * Cria um mensalista e gera o PIX para o primeiro pagamento.
 * Body: { court_id, client_name, client_phone?, day_of_week, start_hour, end_hour }
 */
async function create(req, res) {
  const { court_id, client_name, client_phone, client_document, group_name, day_of_week, start_hour, end_hour } = req.body;

  if (!court_id || !client_name || day_of_week === undefined || !start_hour || !end_hour) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  if (day_of_week < 0 || day_of_week > 6) {
    return res.status(400).json({ error: 'day_of_week deve ser entre 0 (Dom) e 6 (Sáb)' });
  }

  if (start_hour >= end_hour) {
    return res.status(400).json({ error: 'start_hour deve ser anterior a end_hour' });
  }

  try {
    // 1. Busca a quadra + estabelecimento
    const court = await prisma.court.findFirst({
      where:   { id: court_id, active: true },
      include: { establishment: { include: { financial: true } } },
    });
    if (!court) return res.status(404).json({ error: 'Quadra não encontrada' });

    // 2. Verifica conflito de mensalista
    const conflict = await hasConflict(court_id, day_of_week, start_hour, end_hour);
    if (conflict) {
      return res.status(409).json({ error: 'Já existe um mensalista ativo neste horário' });
    }

    // 3. Calcula valor — usa mensalista_rate se configurado, senão hourly_rate
    const rate          = court.mensalista_rate ?? court.hourly_rate;
    const durationHours = parseInt(end_hour) - parseInt(start_hour);
    const totalReais    = durationHours * rate;
    const amountCents   = Math.round(totalReais * 100);

    const dayName = DAY_NAMES[day_of_week] || day_of_week;
    const description = `Mensalista ${dayName} ${start_hour}-${end_hour} | ${court.establishment.name}`;

    // 4. Gera PIX no Pagar.me
    const recipientId = court.establishment.financial?.pagarme_recipient_id || null;
    let pixData = {};
    try {
      const order = await createOrder({
        amountCents,
        recipientId,
        description,
        customerName:     client_name,
        customerEmail:    `${req.user.firebase_uid}@arenaflow.app`,
        customerDocument: client_document || '', // CPF do perfil do usuário; fallback para placeholder válido
        customerPhone:    client_phone || '',
      });
      pixData = {
        pagarme_order_id:  order.orderId,
        pagarme_charge_id: order.chargeId,
        pix_qr_code:       order.qrCode,
        pix_qr_code_url:   order.qrCodeUrl,
        pix_expires_at:    order.expiresAt ? new Date(order.expiresAt) : null,
      };
    } catch (pixErr) {
      console.error('[MENSALISTA] Erro ao gerar PIX:', pixErr.message);
      return res.status(502).json({ error: 'Erro ao gerar PIX: ' + pixErr.message });
    }

    // 5. Cria o registro
    const mensalista = await prisma.mensalista.create({
      data: {
        court_id,
        user_uid:       req.user.firebase_uid,
        client_name,
        client_phone:   client_phone || null,
        group_name:     group_name   || null,
        day_of_week,
        start_hour,
        end_hour,
        payment_status: 'PENDENTE',
        status:         'INATIVO',
        ...pixData,
      },
      include: {
        court: { select: { name: true, establishment: { select: { name: true } } } },
      },
    });

    return res.status(201).json(mensalista);
  } catch (err) {
    console.error('[MENSALISTA] create:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/mensalistas/me
 * Lista os mensalistas do usuário autenticado.
 */
async function listMe(req, res) {
  try {
    const mensalistas = await prisma.mensalista.findMany({
      where:   { user_uid: req.user.firebase_uid },
      include: {
        court: {
          select: {
            name:            true,
            hourly_rate:     true,
            mensalista_rate: true,
            establishment: { select: { name: true, logo_color: true, logo_initials: true } },
          },
        },
      },
      orderBy: [{ day_of_week: 'asc' }, { start_hour: 'asc' }],
    });

    return res.json(mensalistas);
  } catch (err) {
    console.error('[MENSALISTA] listMe:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/mensalistas/:id
 * Detalhe de um mensalista (cliente pode ver o próprio).
 */
async function getOne(req, res) {
  try {
    const mensalista = await prisma.mensalista.findFirst({
      where:   { id: req.params.id, user_uid: req.user.firebase_uid },
      include: {
        court: {
          select: {
            name:          true,
            hourly_rate:   true,
            establishment: { select: { name: true, logo_color: true, logo_initials: true } },
          },
        },
      },
    });

    if (!mensalista) return res.status(404).json({ error: 'Mensalista não encontrado' });
    return res.json(mensalista);
  } catch (err) {
    console.error('[MENSALISTA] getOne:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/mensalistas/:id
 * Cliente cancela o próprio mensalista.
 * Estorna o PIX se houver pagamento confirmado.
 */
async function cancel(req, res) {
  try {
    const mensalista = await prisma.mensalista.findFirst({
      where: { id: req.params.id, user_uid: req.user.firebase_uid },
    });
    if (!mensalista) return res.status(404).json({ error: 'Mensalista não encontrado' });

    if (mensalista.status === 'INATIVO' && mensalista.payment_status === 'CANCELADO') {
      return res.status(409).json({ error: 'Mensalista já está cancelado' });
    }

    // Tenta estornar se pagamento estava PAGO
    if (mensalista.payment_status === 'PAGO' && mensalista.pagarme_charge_id) {
      try {
        await cancelCharge(mensalista.pagarme_charge_id);
        console.log('[MENSALISTA] Estorno solicitado para charge:', mensalista.pagarme_charge_id);
      } catch (refundErr) {
        console.warn('[MENSALISTA] Falha ao estornar (charge pode já ter sido cancelada):', refundErr.message);
      }
    }

    await prisma.mensalista.update({
      where: { id: mensalista.id },
      data:  { status: 'INATIVO', payment_status: 'CANCELADO', updated_at: new Date() },
    });

    return res.json({ ok: true, message: 'Mensalista cancelado com sucesso' });
  } catch (err) {
    console.error('[MENSALISTA] cancel:', err);
    return res.status(500).json({ error: err.message });
  }
}

/* ── Endpoints do admin ───────────────────────────────────────────────────── */

/**
 * GET /api/admin/mensalistas
 * Admin lista mensalistas da própria arena.
 * Query: ?status=ATIVO|INATIVO|EXPIRADO (opcional)
 */
async function adminList(req, res) {
  try {
    // Busca o estabelecimento do admin logado
    const establishment = await prisma.establishment.findFirst({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const { status, court_id } = req.query;

    const mensalistas = await prisma.mensalista.findMany({
      where: {
        court: { establishment_id: establishment.id },
        ...(status    ? { status }    : {}),
        ...(court_id  ? { court_id }  : {}),
      },
      include: {
        court: { select: { name: true, hourly_rate: true, mensalista_rate: true } },
      },
      orderBy: [{ day_of_week: 'asc' }, { start_hour: 'asc' }, { client_name: 'asc' }],
    });

    return res.json(mensalistas);
  } catch (err) {
    console.error('[MENSALISTA] adminList:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * PATCH /api/admin/mensalistas/:id/inativar
 * Admin inativa manualmente um mensalista.
 */
async function adminInativar(req, res) {
  try {
    const establishment = await prisma.establishment.findFirst({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    // Garante que a quadra pertence ao estabelecimento
    const mensalista = await prisma.mensalista.findFirst({
      where: {
        id:    req.params.id,
        court: { establishment_id: establishment.id },
      },
    });
    if (!mensalista) return res.status(404).json({ error: 'Mensalista não encontrado' });

    if (mensalista.status === 'INATIVO') {
      return res.status(409).json({ error: 'Mensalista já está inativo' });
    }

    await prisma.mensalista.update({
      where: { id: mensalista.id },
      data:  { status: 'INATIVO', updated_at: new Date() },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[MENSALISTA] adminInativar:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/mensalistas/:id/renovar
 * Cliente renova o próprio mensalista ATIVO gerando um novo PIX.
 * O valid_until será estendido a partir do valid_until atual (ou de agora,
 * se já expirou) quando o webhook charge.paid confirmar o pagamento.
 */
async function renovar(req, res) {
  try {
    const mensalista = await prisma.mensalista.findFirst({
      where:   { id: req.params.id, user_uid: req.user.firebase_uid, status: 'ATIVO' },
      include: { court: { include: { establishment: { include: { financial: true } } } } },
    });

    if (!mensalista) {
      return res.status(404).json({ error: 'Mensalista não encontrado ou não elegível para renovação' });
    }

    // Calcula valor — usa mensalista_rate se configurado, senão hourly_rate
    const rate          = mensalista.court.mensalista_rate ?? mensalista.court.hourly_rate;
    const durationHours = parseInt(mensalista.end_hour) - parseInt(mensalista.start_hour);
    const totalReais    = durationHours * rate;
    const amountCents   = Math.round(totalReais * 100);

    const dayName = DAY_NAMES[mensalista.day_of_week];
    const description = `Renovação Mensalista ${dayName} ${mensalista.start_hour}-${mensalista.end_hour} | ${mensalista.court.establishment.name}`;

    const recipientId = mensalista.court.establishment.financial?.pagarme_recipient_id || null;
    let pixData = {};
    try {
      const order = await createOrder({
        amountCents,
        recipientId,
        description,
        customerName:     mensalista.client_name,
        customerEmail:    `${req.user.firebase_uid}@arenaflow.app`,
        customerDocument: '',
        customerPhone:    mensalista.client_phone || '',
      });
      pixData = {
        pagarme_order_id:  order.orderId,
        pagarme_charge_id: order.chargeId,
        pix_qr_code:       order.qrCode,
        pix_qr_code_url:   order.qrCodeUrl,
        pix_expires_at:    order.expiresAt ? new Date(order.expiresAt) : null,
      };
    } catch (pixErr) {
      console.error('[MENSALISTA] renovar - erro PIX:', pixErr.message);
      return res.status(502).json({ error: 'Erro ao gerar PIX: ' + pixErr.message });
    }

    // Atualiza o registro com o novo PIX — mantém status ATIVO, volta payment_status a PENDENTE
    const updated = await prisma.mensalista.update({
      where: { id: mensalista.id },
      data:  { payment_status: 'PENDENTE', ...pixData, updated_at: new Date() },
      include: {
        court: { select: { name: true, establishment: { select: { name: true, logo_color: true, logo_initials: true } } } },
      },
    });

    console.log(`[MENSALISTA] renovar: novo PIX gerado para ${mensalista.id}`);
    return res.json(updated);
  } catch (err) {
    console.error('[MENSALISTA] renovar:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/mensalistas/slots?court_id=X&day_of_week=Y
 * Público — retorna os intervalos bloqueados por mensalistas ATIVOS
 * para uma quadra + dia da semana específicos.
 * Usado pelo app cliente para desabilitar horários na tela de seleção.
 */
async function slots(req, res) {
  const { court_id, day_of_week } = req.query;
  if (!court_id || day_of_week === undefined) {
    return res.status(400).json({ error: 'court_id e day_of_week são obrigatórios' });
  }

  const dow = parseInt(day_of_week);
  if (isNaN(dow) || dow < 0 || dow > 6) {
    return res.status(400).json({ error: 'day_of_week deve ser entre 0 e 6' });
  }

  try {
    const blocked = await prisma.mensalista.findMany({
      where:  { court_id, day_of_week: dow, status: 'ATIVO' },
      select: { start_hour: true, end_hour: true },
    });
    return res.json({ slots: blocked });
  } catch (err) {
    console.error('[MENSALISTA] slots:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/mensalistas/:id/reemitir-pix
 * Regenera o PIX para um mensalista ainda PENDENTE (QR expirado ou nunca gerado).
 * Só funciona se payment_status === 'PENDENTE'.
 */
async function reemitirPix(req, res) {
  try {
    const mensalista = await prisma.mensalista.findFirst({
      where:   { id: req.params.id, user_uid: req.user.firebase_uid, payment_status: 'PENDENTE' },
      include: { court: { include: { establishment: { include: { financial: true } } } } },
    });
    if (!mensalista) {
      return res.status(404).json({ error: 'Mensalista não encontrado ou já não está pendente' });
    }

    const rate          = mensalista.court.mensalista_rate ?? mensalista.court.hourly_rate;
    const durationHours = parseInt(mensalista.end_hour) - parseInt(mensalista.start_hour);
    const amountCents   = Math.round(durationHours * rate * 100);

    const dayName     = DAY_NAMES[mensalista.day_of_week];
    const description = `Mensalista ${dayName} ${mensalista.start_hour}-${mensalista.end_hour} | ${mensalista.court.establishment.name}`;
    const recipientId = mensalista.court.establishment.financial?.pagarme_recipient_id || null;

    let pixData = {};
    try {
      const order = await createOrder({
        amountCents,
        recipientId,
        description,
        customerName:     mensalista.client_name,
        customerEmail:    `${req.user.firebase_uid}@arenaflow.app`,
        customerDocument: '',
        customerPhone:    mensalista.client_phone || '',
      });
      pixData = {
        pagarme_order_id:  order.orderId,
        pagarme_charge_id: order.chargeId,
        pix_qr_code:       order.qrCode,
        pix_qr_code_url:   order.qrCodeUrl,
        pix_expires_at:    order.expiresAt ? new Date(order.expiresAt) : null,
      };
    } catch (pixErr) {
      return res.status(502).json({ error: 'Erro ao gerar PIX: ' + pixErr.message });
    }

    const updated = await prisma.mensalista.update({
      where:   { id: mensalista.id },
      data:    { ...pixData, updated_at: new Date() },
      include: {
        court: {
          select: {
            name:            true,
            hourly_rate:     true,
            mensalista_rate: true,
            establishment:   { select: { name: true, logo_color: true, logo_initials: true } },
          },
        },
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error('[MENSALISTA] reemitirPix:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { create, listMe, getOne, cancel, renovar, reemitirPix, adminList, adminInativar, slots };
