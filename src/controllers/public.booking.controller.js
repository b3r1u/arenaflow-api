const prisma = require('../lib/prisma');

/**
 * GET /api/reserva/:id
 * Endpoint público — qualquer pessoa com o link pode visualizar.
 * Retorna dados da reserva + grupo de pagamento + splits (sem dados sensíveis).
 */
async function getPublicBooking(req, res) {
  const { id } = req.params;

  try {
    const booking = await prisma.booking.findUnique({
      where:   { id },
      include: {
        court: {
          select: { name: true, sport_type: true, establishment: { select: { name: true, logo_color: true, logo_url: true, logo_initials: true } } },
        },
        payment_group: {
          include: {
            splits: {
              orderBy: { created_at: 'asc' },
              select: {
                id:             true,
                player_name:    true,
                amount:         true,
                pix_qr_code:    true,
                pix_copy_paste: true,
                pix_expires_at: true,
                status:         true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }

    return res.json({
      booking: {
        id:             booking.id,
        date:           booking.date,
        start_hour:     booking.start_hour,
        end_hour:       booking.end_hour,
        total_amount:   booking.total_amount,
        paid_amount:    booking.paid_amount,
        payment_status: booking.payment_status,
        court_name:     booking.court.name,
        sport_type:     booking.court.sport_type,
        arena: {
          name:          booking.court.establishment.name,
          logo_color:    booking.court.establishment.logo_color,
          logo_url:      booking.court.establishment.logo_url,
          logo_initials: booking.court.establishment.logo_initials,
        },
        payment_group: booking.payment_group ? {
          id:           booking.payment_group.id,
          payment_type: booking.payment_group.payment_type,
          total_amount: booking.payment_group.total_amount,
          paid_amount:  booking.payment_group.paid_amount,
          status:       booking.payment_group.status,
          splits:       booking.payment_group.splits,
        } : null,
      },
    });

  } catch (err) {
    console.error('[PUBLIC_BOOKING]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { getPublicBooking };
