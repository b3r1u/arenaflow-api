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

module.exports = { getStats, getRevenue7Days };
