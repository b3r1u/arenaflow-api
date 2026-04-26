const prisma = require('../lib/prisma');

/* ── helpers ─────────────────────────────────────────────────── */

function toDbStatus(s) {
  if (!s) return 'PENDENTE';
  const u = s.toUpperCase();
  if (u === 'PAGO')      return 'PAGO';
  if (u === 'PARCIAL')   return 'PARCIAL';
  if (u === 'CANCELADO') return 'CANCELADO';
  return 'PENDENTE';
}

function fromDbStatus(s) {
  return s ? s.toLowerCase() : 'pendente';
}

function toDto(b) {
  const pg = b.payment_group ?? null;
  return {
    id:             b.id,
    client_name:    b.client_name,
    client_phone:   b.client_phone || null,
    court_id:       b.court?.id    ?? b.court_id,
    court_name:     b.court?.name  ?? null,
    sport_type:     b.court?.sport_type ?? null,
    date:           b.date,
    start_hour:     b.start_hour,
    end_hour:       b.end_hour,
    total_amount:   Number(b.total_amount),
    paid_amount:    Number(b.paid_amount),
    payment_status: fromDbStatus(b.payment_status),
    split_payment:  b.split_payment ?? false,
    num_players:    b.num_players   ?? null,
    payment_group:  pg ? {
      id:           pg.id,
      payment_type: pg.payment_type,
      total_amount: pg.total_amount,
      paid_amount:  pg.paid_amount,
      status:       pg.status,
      splits:       (pg.splits ?? []).map(s => ({
        id:          s.id,
        player_name: s.player_name,
        amount:      s.amount,
        status:      s.status,
        pix_expires_at: s.pix_expires_at,
      })),
    } : null,
  };
}

/* ── GET /api/admin/bookings?date=YYYY-MM-DD ─────────────────── */

async function listByDate(req, res) {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date é obrigatório (YYYY-MM-DD)' });

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const rows = await prisma.booking.findMany({
      where: {
        court: { establishment_id: establishment.id },
        date,
        payment_status: { not: 'CANCELADO' },
      },
      select: {
        id:             true,
        client_name:    true,
        client_phone:   true,
        date:           true,
        start_hour:     true,
        end_hour:       true,
        total_amount:   true,
        paid_amount:    true,
        payment_status: true,
        split_payment:  true,
        num_players:    true,
        court: { select: { id: true, name: true, sport_type: true } },
        payment_group: {
          select: {
            id: true, payment_type: true, total_amount: true,
            paid_amount: true, status: true,
            splits: { select: { id: true, player_name: true, amount: true, status: true, pix_expires_at: true }, orderBy: { created_at: 'asc' } },
          },
        },
      },
      orderBy: { start_hour: 'asc' },
    });

    return res.json({ bookings: rows.map(toDto) });
  } catch (err) {
    console.error('[ADMIN/BOOKINGS/LIST]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/* ── POST /api/admin/bookings ────────────────────────────────── */

async function create(req, res) {
  const {
    client_name, client_phone,
    court_id, date, start_hour, end_hour,
    payment_status, total_amount,
  } = req.body;

  if (!client_name || !court_id || !date || !start_hour || !end_hour) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const court = await prisma.court.findFirst({
      where: { id: court_id, establishment_id: establishment.id },
    });
    if (!court) return res.status(404).json({ error: 'Quadra não encontrada' });

    // Verifica conflito de horário
    const conflict = await prisma.booking.findFirst({
      where: {
        court_id,
        date,
        payment_status: { not: 'CANCELADO' },
        OR: [{ start_hour: { lt: end_hour }, end_hour: { gt: start_hour } }],
      },
    });
    if (conflict) return res.status(409).json({ error: 'Conflito de horário' });

    const durationHours  = parseInt(end_hour) - parseInt(start_hour);
    const computedTotal  = total_amount ?? durationHours * Number(court.hourly_rate);
    const dbStatus       = toDbStatus(payment_status);
    const paidAmt        = dbStatus === 'PAGO' ? computedTotal : 0;

    const booking = await prisma.booking.create({
      data: {
        arena_id:       establishment.id,
        court_id,
        user_uid:       '',
        client_name,
        client_phone:   client_phone || null,
        date,
        start_hour,
        end_hour,
        duration_hours: durationHours,
        total_amount:   computedTotal,
        paid_amount:    paidAmt,
        payment_option: '100',
        payment_status: dbStatus,
      },
      include: { court: { select: { id: true, name: true, sport_type: true } } },
    });

    return res.status(201).json({ booking: toDto(booking) });
  } catch (err) {
    console.error('[ADMIN/BOOKINGS/CREATE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/* ── PATCH /api/admin/bookings/:id ───────────────────────────── */

async function update(req, res) {
  const { id } = req.params;
  const {
    client_name, client_phone,
    date, start_hour, end_hour,
    payment_status, total_amount,
  } = req.body;

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const existing = await prisma.booking.findFirst({
      where: { id, court: { establishment_id: establishment.id } },
    });
    if (!existing) return res.status(404).json({ error: 'Reserva não encontrada' });

    const data = {};
    if (client_name  !== undefined) data.client_name   = client_name;
    if (client_phone !== undefined) data.client_phone  = client_phone || null;
    if (date         !== undefined) data.date          = date;
    if (start_hour   !== undefined) data.start_hour    = start_hour;
    if (end_hour     !== undefined) data.end_hour      = end_hour;
    if (total_amount !== undefined) data.total_amount  = total_amount;

    if (payment_status !== undefined) {
      const dbStatus   = toDbStatus(payment_status);
      data.payment_status = dbStatus;
      if (dbStatus === 'PAGO')  data.paid_amount = total_amount ?? Number(existing.total_amount);
      if (dbStatus === 'PENDENTE') data.paid_amount = 0;
    }

    if (start_hour !== undefined && end_hour !== undefined) {
      data.duration_hours = parseInt(end_hour) - parseInt(start_hour);
    }

    const updated = await prisma.booking.update({
      where: { id },
      data,
      include: { court: { select: { id: true, name: true, sport_type: true } } },
    });

    return res.json({ booking: toDto(updated) });
  } catch (err) {
    console.error('[ADMIN/BOOKINGS/UPDATE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/* ── DELETE /api/admin/bookings/:id ──────────────────────────── */

async function cancel(req, res) {
  const { id } = req.params;

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const existing = await prisma.booking.findFirst({
      where: { id, court: { establishment_id: establishment.id } },
    });
    if (!existing) return res.status(404).json({ error: 'Reserva não encontrada' });

    await prisma.booking.update({
      where: { id },
      data: { payment_status: 'CANCELADO' },
    });

    return res.json({ message: 'Reserva cancelada' });
  } catch (err) {
    console.error('[ADMIN/BOOKINGS/CANCEL]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/* ── GET /api/admin/bookings/month?month=YYYY-MM ─────────────── */

async function listByMonth(req, res) {
  const { month } = req.query;
  const now = new Date();
  const m = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, monthNum] = m.split('-').map(Number);
  const startDate = `${m}-01`;
  const lastDay   = new Date(year, monthNum, 0).getDate();
  const endDate   = `${m}-${String(lastDay).padStart(2, '0')}`;

  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const rows = await prisma.booking.findMany({
      where: {
        court: { establishment_id: establishment.id },
        date:  { gte: startDate, lte: endDate },
      },
      select: {
        id:             true,
        client_name:    true,
        client_phone:   true,
        date:           true,
        start_hour:     true,
        end_hour:       true,
        total_amount:   true,
        paid_amount:    true,
        payment_status: true,
        split_payment:  true,
        num_players:    true,
        court: { select: { id: true, name: true, sport_type: true } },
        payment_group: {
          select: {
            id: true, payment_type: true, total_amount: true,
            paid_amount: true, status: true,
            splits: { select: { id: true, player_name: true, amount: true, status: true, pix_expires_at: true }, orderBy: { created_at: 'asc' } },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { start_hour: 'desc' }],
    });

    return res.json({ bookings: rows.map(toDto) });
  } catch (err) {
    console.error('[ADMIN/BOOKINGS/MONTH]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { listByDate, listByMonth, create, update, cancel };
