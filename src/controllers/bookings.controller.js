const prisma  = require('../lib/prisma');
const { createOrder, cancelCharge } = require('../lib/pagarme.service');

/* ── Helpers de cancelamento ─────────────────────────────────────────────── */

/** Constrói Date a partir de booking.date (YYYY-MM-DD) + start_hour (HH:00). */
function bookingStartDateTime(b) {
  return new Date(`${b.date}T${b.start_hour}:00`);
}

/**
 * Calcula a elegibilidade e o custo do cancelamento.
 * @param {object} booking — precisa ter date, start_hour, paid_amount
 * @param {object} policy  — { cancel_policy_enabled, cancel_limit_hours, cancel_fee_percent }
 * @param {Date}   now     — referência temporal (default: agora)
 * @returns {{ requires_fee:boolean, hours_remaining:number, fee_amount:number, refund_amount:number, reason:string }}
 */
function computeCancelInfo(booking, policy, now = new Date()) {
  const start = bookingStartDateTime(booking);
  const hoursRemaining = (start.getTime() - now.getTime()) / 3600000;

  // Política desativada → grátis sempre
  if (!policy?.cancel_policy_enabled) {
    return {
      requires_fee:    false,
      hours_remaining: hoursRemaining,
      fee_amount:      0,
      refund_amount:   booking.paid_amount,
      reason:          'POLICY_DISABLED',
    };
  }

  // Dentro da janela → grátis
  if (hoursRemaining >= (policy.cancel_limit_hours || 0)) {
    return {
      requires_fee:    false,
      hours_remaining: hoursRemaining,
      fee_amount:      0,
      refund_amount:   booking.paid_amount,
      reason:          'WITHIN_LIMIT',
    };
  }

  // Fora da janela → aplica taxa (em reais, 2 casas)
  const feePct       = Math.max(0, Math.min(100, policy.cancel_fee_percent || 0));
  const feeAmount    = Math.round(booking.paid_amount * feePct) / 100;
  const refundAmount = Math.round((booking.paid_amount - feeAmount) * 100) / 100;
  return {
    requires_fee:    feeAmount > 0,
    hours_remaining: hoursRemaining,
    fee_amount:      feeAmount,
    refund_amount:   refundAmount,
    reason:          'OUT_OF_WINDOW',
  };
}

/**
 * POST /api/bookings
 * Cria reserva, gera PIX no Pagar.me e retorna QR code.
 * Autenticado — o user_uid vem do token Firebase (req.user.uid).
 */
async function create(req, res) {
  const {
    arena_id, court_id,
    client_name, client_phone,
    date, start_hour, end_hour,
    payment_option, split_payment, num_players,
  } = req.body;

  if (!arena_id || !court_id || !date || !start_hour || !end_hour || !client_name) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }

  try {
    // 1. Busca a quadra e o estabelecimento
    const court = await prisma.court.findFirst({
      where: { id: court_id, active: true },
      include: { establishment: { include: { financial: true } } },
    });
    if (!court) return res.status(404).json({ error: 'Quadra não encontrada' });

    // 2. Verifica conflito de horário
    const conflict = await prisma.booking.findFirst({
      where: {
        court_id,
        date,
        payment_status: { not: 'CANCELADO' },
        OR: [
          { start_hour: { lt: end_hour }, end_hour: { gt: start_hour } },
        ],
      },
    });
    if (conflict) return res.status(409).json({ error: 'Horário indisponível' });

    // 3. Calcula valores
    const durationHours = parseInt(end_hour) - parseInt(start_hour);
    const totalAmount   = durationHours * court.hourly_rate;
    const paidAmount    = payment_option === '50' ? totalAmount / 2 : totalAmount;
    const amountCents   = Math.round(paidAmount * 100);

    const recipientId = court.establishment.financial?.pagarme_recipient_id;

    // 4. Cria order PIX no Pagar.me
    // recipientId=null → PIX simples (sem split); com id → split para o dono da arena (requer conta PSP)
    let pixData = {};
    try {
      pixData = await createOrder({
        amountCents,
        recipientId: recipientId || null,
        description:      `${court.name} — ${durationHours}h (${date} ${start_hour}–${end_hour})`,
        customerName:     client_name,
        customerEmail:    req.user?.email || 'cliente@arenaflow.app',
        customerDocument: req.body.client_document || '',
        customerPhone:    client_phone || req.user?.phone || '',
      });
    } catch (pixErr) {
      console.error('[BOOKINGS] PIX falhou, criando reserva sem QR code:', pixErr.message);
    }

    // 5. Salva booking
    const booking = await prisma.booking.create({
      data: {
        arena_id,
        court_id,
        user_uid:         req.user?.firebase_uid || '',
        client_name,
        client_phone:     client_phone || null,
        date,
        start_hour,
        end_hour,
        duration_hours:   durationHours,
        total_amount:     totalAmount,
        paid_amount:      paidAmount,
        payment_option:   payment_option || '100',
        payment_status:   'PENDENTE',
        split_payment:    !!split_payment,
        num_players:      split_payment ? (num_players || 2) : null,
        pagarme_order_id: pixData.orderId  || null,
        pagarme_charge_id: pixData.chargeId || null,
        pix_qr_code:      pixData.qrCode   || null,
        pix_qr_code_url:  pixData.qrCodeUrl || null,
        pix_expires_at:   pixData.expiresAt ? new Date(pixData.expiresAt) : null,
      },
    });

    return res.status(201).json({
      booking: {
        id:             booking.id,
        arena_id:       booking.arena_id,
        court_id:       booking.court_id,
        client_name:    booking.client_name,
        date:           booking.date,
        start_hour:     booking.start_hour,
        end_hour:       booking.end_hour,
        total_amount:   booking.total_amount,
        paid_amount:    booking.paid_amount,
        payment_option: booking.payment_option,
        payment_status: booking.payment_status.toLowerCase(),
        split_payment:  booking.split_payment,
        num_players:    booking.num_players,
        pix_qr_code:    booking.pix_qr_code,
        pix_qr_code_url: booking.pix_qr_code_url,
        pix_expires_at: booking.pix_expires_at,
        duration_hours: booking.duration_hours,
        arena_name:     court.establishment.name,
        court_name:     court.name,
      },
    });
  } catch (err) {
    console.error('[BOOKINGS/CREATE]', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao criar reserva' });
  }
}

/**
 * GET /api/bookings/:id
 * Retorna o status atualizado da reserva.
 */
async function getById(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, user_uid: req.user.firebase_uid },
    });
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada' });

    return res.json({
      booking: {
        ...booking,
        payment_status: booking.payment_status.toLowerCase(),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/bookings/:id/simulate-payment
 * SANDBOX ONLY — Simula pagamento confirmado sem precisar de webhook.
 */
async function simulatePayment(req, res) {
  try {
    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: {
        payment_status: 'PAGO',
        paid_amount:    (await prisma.booking.findUnique({ where: { id: req.params.id } }))?.total_amount || 0,
        updated_at:     new Date(),
      },
    });
    return res.json({ ok: true, payment_status: booking.payment_status.toLowerCase() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/bookings/me
 * Retorna todas as reservas do usuário logado.
 */
async function getMyBookings(req, res) {
  try {
    const bookings = await prisma.booking.findMany({
      where: { user_uid: req.user.firebase_uid },
      orderBy: { created_at: 'desc' },
    });
    return res.json({
      bookings: bookings.map(b => ({
        id:              b.id,
        arena_id:        b.arena_id,
        court_id:        b.court_id,
        client_name:     b.client_name,
        date:            b.date,
        start_hour:      b.start_hour,
        end_hour:        b.end_hour,
        duration_hours:  b.duration_hours,
        total_amount:    b.total_amount,
        paid_amount:     b.paid_amount,
        payment_option:  b.payment_option,
        payment_status:  b.payment_status.toLowerCase(),
        split_payment:   b.split_payment,
        num_players:     b.num_players,
        pix_qr_code:     b.pix_qr_code,
        pix_qr_code_url: b.pix_qr_code_url,
        pagarme_order_id: b.pagarme_order_id,
        created_at:      b.created_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/bookings/availability?arena_id=&court_id=&date=
 * Público — retorna os horários ocupados de uma quadra numa data.
 */
async function getAvailability(req, res) {
  const { arena_id, court_id, date } = req.query;
  if (!arena_id || !court_id || !date) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: arena_id, court_id, date' });
  }
  try {
    const bookings = await prisma.booking.findMany({
      where: {
        arena_id,
        court_id,
        date,
        payment_status: { not: 'CANCELADO' },
      },
      select: { start_hour: true, end_hour: true },
    });
    return res.json({ slots: bookings });
  } catch (err) {
    console.error('[getAvailability]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar disponibilidade' });
  }
}

/**
 * GET /api/bookings/:id/cancel-preview
 * Retorna o cálculo do cancelamento sem efeito colateral.
 * Usado pelo cliente para exibir aviso de multa antes de confirmar.
 */
async function getCancelPreview(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where:   { id: req.params.id, user_uid: req.user.firebase_uid },
      include: {
        court: {
          include: {
            establishment: {
              select: {
                cancel_policy_enabled: true,
                cancel_limit_hours:    true,
                cancel_fee_percent:    true,
              },
            },
          },
        },
      },
    });
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada' });
    if (booking.payment_status === 'CANCELADO') {
      return res.status(409).json({ error: 'Reserva já está cancelada' });
    }
    if (bookingStartDateTime(booking).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'Reserva já iniciou ou foi finalizada' });
    }

    const info = computeCancelInfo(booking, booking.court.establishment);
    return res.json(info);
  } catch (err) {
    console.error('[BOOKINGS/CANCEL_PREVIEW]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/bookings/:id/cancel
 * Executa o cancelamento aplicando a política da arena.
 * Etapa 1 — atualiza status e devolve o cálculo. Estorno via Pagar.me na Etapa 2.
 */
async function cancel(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where:   { id: req.params.id, user_uid: req.user.firebase_uid },
      include: {
        court: {
          include: {
            establishment: {
              select: {
                cancel_policy_enabled: true,
                cancel_limit_hours:    true,
                cancel_fee_percent:    true,
              },
            },
          },
        },
        payment_group: { include: { splits: true } },
      },
    });
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada' });
    if (booking.payment_status === 'CANCELADO') {
      return res.status(409).json({ error: 'Reserva já está cancelada' });
    }
    if (bookingStartDateTime(booking).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'Reserva já iniciou ou foi finalizada' });
    }

    const info = computeCancelInfo(booking, booking.court.establishment);

    // Atualiza booking → CANCELADO (refund_amount/fee_amount armazenados implicitamente em logs)
    await prisma.booking.update({
      where: { id: booking.id },
      data:  { payment_status: 'CANCELADO', updated_at: new Date() },
    });

    // ── Etapa 2: Estorno via Pagar.me ────────────────────────────────────────
    const feePct = booking.court.establishment.cancel_fee_percent || 0;

    if (booking.payment_group?.splits?.length > 0) {
      // Fluxo split (SPLIT ou DEPOSIT): estorna cada cota paga individualmente
      const splitsPagas = booking.payment_group.splits.filter(s => s.status === 'PAGO');

      for (const split of splitsPagas) {
        if (!split.pagarme_charge_id) {
          console.warn(`[BOOKINGS/CANCEL] split ${split.id} sem charge_id — pulando estorno`);
          continue;
        }

        // Estorno integral (sem taxa) ou parcial (com taxa) em centavos
        const refundCents = info.requires_fee
          ? Math.round(split.amount * (100 - feePct) / 100)
          : null; // null = estorno integral

        try {
          await cancelCharge(split.pagarme_charge_id, refundCents);
          await prisma.bookingPaymentSplit.update({
            where: { id: split.id },
            data:  { status: 'ESTORNADO', updated_at: new Date() },
          });
          console.log(`[BOOKINGS/CANCEL] split ${split.id} estornado — R$${(refundCents ?? split.amount) / 100}`);
        } catch (refundErr) {
          // Loga mas não aborta: o booking já está CANCELADO no banco
          console.error(`[BOOKINGS/CANCEL] falha ao estornar split ${split.id}:`, refundErr.message);
        }
      }

    } else if (booking.pagarme_charge_id && booking.paid_amount > 0) {
      // Fluxo 100% individual (sem grupo): estorna a charge direta do booking
      const refundCents = info.requires_fee
        ? Math.round(info.refund_amount * 100)
        : null; // null = estorno integral

      try {
        await cancelCharge(booking.pagarme_charge_id, refundCents);
        console.log(`[BOOKINGS/CANCEL] charge ${booking.pagarme_charge_id} estornada — R$${(refundCents ?? booking.paid_amount * 100) / 100}`);
      } catch (refundErr) {
        console.error(`[BOOKINGS/CANCEL] falha ao estornar charge ${booking.pagarme_charge_id}:`, refundErr.message);
      }
    }

    console.log(`[BOOKINGS/CANCEL] ${booking.id} cancelada — reason=${info.reason} fee=R$${info.fee_amount} refund=R$${info.refund_amount}`);

    return res.json({ ok: true, ...info });
  } catch (err) {
    console.error('[BOOKINGS/CANCEL]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { create, getById, getMyBookings, simulatePayment, getAvailability, getCancelPreview, cancel };
