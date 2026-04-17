const prisma = require('../lib/prisma');

/**
 * GET /api/dashboard/stats
 * Retorna métricas do dashboard para o estabelecimento autenticado.
 */
async function getStats(req, res) {
  try {
    // Busca o estabelecimento do admin logado
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });

    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    // Datas de referência no fuso de Brasília (UTC-3)
    const TZ_OFFSET  = '-03:00';
    const nowBrazil  = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const todayStr   = nowBrazil.toISOString().slice(0, 10); // YYYY-MM-DD no horário de Brasília

    const firstOfMonth = new Date(nowBrazil.getFullYear(), nowBrazil.getMonth(), 1)
      .toISOString().slice(0, 10);
    const lastOfMonth  = new Date(nowBrazil.getFullYear(), nowBrazil.getMonth() + 1, 0)
      .toISOString().slice(0, 10);

    const whereEstablishment = {
      court: { establishment_id: establishment.id },
    };

    // Intervalo do dia atual em Brasília (convertido para UTC no banco)
    const todayStart = new Date(`${todayStr}T00:00:00.000${TZ_OFFSET}`);
    const todayEnd   = new Date(`${todayStr}T23:59:59.999${TZ_OFFSET}`);

    // Reservas criadas hoje (independente da data da reserva)
    const todayBookings = await prisma.booking.findMany({
      where: {
        ...whereEstablishment,
        created_at: { gte: todayStart, lte: todayEnd },
        payment_status: { not: 'CANCELADO' },
      },
      select: { payment_status: true, paid_amount: true },
    });

    const reservasHoje  = todayBookings.length;
    const pagasHoje     = todayBookings.filter(b => b.payment_status === 'PAGO').length;
    const pendentesHoje = todayBookings.filter(b => b.payment_status === 'PENDENTE').length;

    // Receita Hoje = pagamentos confirmados hoje (independente da data da reserva)

    const paidTodayBookings = await prisma.booking.findMany({
      where: {
        ...whereEstablishment,
        payment_status: 'PAGO',
        updated_at: { gte: todayStart, lte: todayEnd },
      },
      select: { paid_amount: true },
    });

    const receitaHoje = paidTodayBookings
      .reduce((sum, b) => sum + Number(b.paid_amount), 0);

    // Reservas do mês
    const monthBookings = await prisma.booking.findMany({
      where: {
        ...whereEstablishment,
        date: { gte: firstOfMonth, lte: lastOfMonth },
        payment_status: { not: 'CANCELADO' },
      },
      select: { payment_status: true, paid_amount: true },
    });

    const reservasMes   = monthBookings.length;
    const receitaMensal = monthBookings
      .filter(b => b.payment_status === 'PAGO')
      .reduce((sum, b) => sum + Number(b.paid_amount), 0);

    return res.json({
      reservasHoje,
      pagasHoje,
      pendentesHoje,
      receitaHoje,
      reservasMes,
      receitaMensal,
    });
  } catch (err) {
    console.error('[DASHBOARD/STATS]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/dashboard/revenue7days
 * Retorna faturamento dos últimos 7 dias para o gráfico.
 */
async function getRevenue7Days(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    const TZ_OFFSET = '-03:00';
    const result = [];

    for (let i = 6; i >= 0; i--) {
      const nowBrazil = new Date(Date.now() - 3 * 60 * 60 * 1000);
      nowBrazil.setDate(nowBrazil.getDate() - i);
      const dateStr = nowBrazil.toISOString().slice(0, 10);

      const dayStart = new Date(`${dateStr}T00:00:00.000${TZ_OFFSET}`);
      const dayEnd   = new Date(`${dateStr}T23:59:59.999${TZ_OFFSET}`);

      const bookings = await prisma.booking.findMany({
        where: {
          court: { establishment_id: establishment.id },
          payment_status: 'PAGO',
          updated_at: { gte: dayStart, lte: dayEnd },
        },
        select: { paid_amount: true },
      });

      const revenue = bookings.reduce((sum, b) => sum + Number(b.paid_amount), 0);
      const [year, month, day] = dateStr.split('-');
      result.push({ day: `${day}/${month}`, revenue });
    }

    return res.json(result);
  } catch (err) {
    console.error('[DASHBOARD/REVENUE7DAYS]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/dashboard/bookings-today
 * Retorna as reservas do dia atual (horário de Brasília) para o estabelecimento.
 */
async function getBookingsToday(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    const TZ_OFFSET = '-03:00';
    const nowBrazil = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const todayStr  = nowBrazil.toISOString().slice(0, 10);

    const todayStart = new Date(`${todayStr}T00:00:00.000${TZ_OFFSET}`);
    const todayEnd   = new Date(`${todayStr}T23:59:59.999${TZ_OFFSET}`);

    const bookings = await prisma.booking.findMany({
      where: {
        court: { establishment_id: establishment.id },
        created_at: { gte: todayStart, lte: todayEnd },
        payment_status: { not: 'CANCELADO' },
      },
      select: {
        id:             true,
        client_name:    true,
        start_hour:     true,
        end_hour:       true,
        payment_status: true,
        total_amount:   true,
        paid_amount:    true,
        court: {
          select: { id: true, name: true, sport_type: true },
        },
      },
      orderBy: { start_hour: 'asc' },
    });

    const result = bookings.map(b => ({
      id:             b.id,
      client_name:    b.client_name,
      start_hour:     b.start_hour,
      end_hour:       b.end_hour,
      payment_status: b.payment_status.toLowerCase(),
      total_amount:   Number(b.total_amount),
      paid_amount:    Number(b.paid_amount),
      court_id:       b.court.id,
      court_name:     b.court.name,
      sport_type:     b.court.sport_type,
    }));

    return res.json({ bookings: result });
  } catch (err) {
    console.error('[DASHBOARD/BOOKINGS-TODAY]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/dashboard/popular-hours
 * Retorna contagem de ocupação por hora (últimos 60 dias) para o gráfico de horários populares.
 */
async function getPopularHours(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // últimos 60 dias

    const bookings = await prisma.booking.findMany({
      where: {
        court: { establishment_id: establishment.id },
        payment_status: { not: 'CANCELADO' },
        created_at: { gte: since },
      },
      select: { start_hour: true, end_hour: true },
    });

    // Inicializa contagem para todas as horas de 07h a 22h
    const counts = {};
    for (let h = 7; h <= 22; h++) {
      counts[`${h.toString().padStart(2, '0')}:00`] = 0;
    }

    // Expande cada reserva nos slots hora a hora
    bookings.forEach(b => {
      const start = parseInt(b.start_hour);
      const end   = parseInt(b.end_hour);
      for (let h = start; h < end; h++) {
        const key = `${h.toString().padStart(2, '0')}:00`;
        if (counts[key] !== undefined) counts[key]++;
      }
    });

    const result = Object.entries(counts).map(([hour, count]) => ({ hour, count }));

    return res.json(result);
  } catch (err) {
    console.error('[DASHBOARD/POPULAR-HOURS]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getStats, getRevenue7Days, getBookingsToday, getPopularHours };
