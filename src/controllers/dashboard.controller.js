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

    // Datas de referência
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().slice(0, 10);
    const lastOfMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString().slice(0, 10);

    const whereEstablishment = {
      court: { establishment_id: establishment.id },
    };

    // Intervalo do dia atual
    const todayStart = new Date(`${todayStr}T00:00:00.000Z`);
    const todayEnd   = new Date(`${todayStr}T23:59:59.999Z`);

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

module.exports = { getStats };
