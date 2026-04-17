const prisma = require('../lib/prisma');

/**
 * GET /api/clients
 * Lista clientes únicos do estabelecimento, agrupados por telefone + nome,
 * com contagem de reservas, total pago e histórico.
 */
async function listClients(req, res) {
  try {
    const establishment = await prisma.establishment.findUnique({
      where: { owner_id: req.user.id },
    });
    if (!establishment) {
      return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    }

    const bookings = await prisma.booking.findMany({
      where: {
        court: { establishment_id: establishment.id },
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
        created_at:     true,
        court: {
          select: { id: true, name: true, sport_type: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Agrupa por telefone (chave principal) ou por nome quando sem telefone
    const map = new Map();

    bookings.forEach(b => {
      const key = b.client_phone?.replace(/\D/g, '') || `name:${b.client_name.toLowerCase().trim()}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          name:          b.client_name,
          phone:         b.client_phone || null,
          total_bookings: 0,
          total_paid:    0,
          last_booking:  null,
          bookings:      [],
        });
      }

      const client = map.get(key);
      client.total_bookings += 1;
      if (b.payment_status === 'PAGO') {
        client.total_paid += Number(b.paid_amount);
      }
      if (!client.last_booking || b.created_at > client.last_booking) {
        client.last_booking = b.created_at;
        client.name = b.client_name; // usa nome mais recente
      }
      client.bookings.push({
        id:             b.id,
        date:           b.date,
        start_hour:     b.start_hour,
        end_hour:       b.end_hour,
        total_amount:   Number(b.total_amount),
        paid_amount:    Number(b.paid_amount),
        payment_status: b.payment_status.toLowerCase(),
        court_id:       b.court.id,
        court_name:     b.court.name,
        sport_type:     b.court.sport_type,
      });
    });

    // Ordena clientes por total pago desc
    const clients = Array.from(map.values())
      .sort((a, b) => b.total_paid - a.total_paid);

    return res.json({ clients });
  } catch (err) {
    console.error('[CLIENTS/LIST]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { listClients };
