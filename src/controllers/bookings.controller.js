const prisma  = require('../lib/prisma');
const { createOrder, cancelCharge, getCharge } = require('../lib/pagarme.service');

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

    // 2. Verifica conflito de horário (booking existente)
    const conflict = await prisma.booking.findFirst({
      where: {
        court_id,
        date,
        payment_status: { notIn: ['CANCELADO', 'ESTORNADO', 'CHARGEDBACK'] },
        OR: [
          { start_hour: { lt: end_hour }, end_hour: { gt: start_hour } },
        ],
      },
    });
    if (conflict) return res.status(409).json({ error: 'Horário indisponível' });

    // 2b. Verifica conflito com mensalista ATIVO no mesmo dia da semana
    const dateObj   = new Date(date + 'T00:00:00');
    const dayOfWeek = dateObj.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
    const mensalistaConflict = await prisma.mensalista.findFirst({
      where: {
        court_id,
        day_of_week: dayOfWeek,
        status:      'ATIVO',
        start_hour:  { lt: end_hour },
        end_hour:    { gt: start_hour },
      },
    });
    if (mensalistaConflict) {
      return res.status(409).json({ error: 'Horário reservado para mensalista' });
    }

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
    // Reservas avulsas
    const bookings = await prisma.booking.findMany({
      where: {
        arena_id,
        court_id,
        date,
        payment_status: { notIn: ['CANCELADO', 'ESTORNADO', 'CHARGEDBACK'] },
      },
      select: { start_hour: true, end_hour: true },
    });

    // Slots bloqueados por mensalistas ATIVOS neste dia da semana
    const dateObj   = new Date(date + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();
    const mensalistas = await prisma.mensalista.findMany({
      where: {
        court_id,
        day_of_week: dayOfWeek,
        status:      'ATIVO',
      },
      select: { start_hour: true, end_hour: true },
    });

    // Une os dois e retorna
    const slots = [
      ...bookings,
      ...mensalistas.map(m => ({ start_hour: m.start_hour, end_hour: m.end_hour, mensalista: true })),
    ];

    return res.json({ slots });
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
 * Executa o cancelamento aplicando a política da arena e dispara estorno real no Pagar.me.
 *
 * Ordem obrigatória:
 *   1. Valida booking
 *   2. Consulta charge na Pagar.me (anti-duplo-estorno)
 *   3. Chama cancelCharge() — se falhar, retorna erro SEM atualizar o banco
 *   4. Somente após sucesso do estorno: atualiza booking para CANCELADO
 *
 * SUGESTÃO DE SCHEMA (não implementado — requer migrate):
 *   BookingPaymentStatus: adicionar ESTORNADO, CHARGEDBACK
 *   Booking: adicionar canceled_at DateTime?
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

    const originalStatus = booking.payment_status;
    const info           = computeCancelInfo(booking, booking.court.establishment);
    const feePct         = booking.court.establishment.cancel_fee_percent || 0;

    let pagarmeRefundRequested = false;
    let refundedChargeId       = null;

    // ── Fluxo split: estorna cada cota paga individualmente ──────────────────
    if (booking.payment_group?.splits?.length > 0) {
      const splitsPagas = booking.payment_group.splits.filter(s => s.status === 'PAGO');
      let splitErrors   = 0;

      for (const split of splitsPagas) {
        if (!split.pagarme_charge_id) {
          console.warn(`[BOOKINGS/CANCEL] split ${split.id} sem charge_id — pulando`);
          continue;
        }

        // Verifica status na Pagar.me para evitar duplo estorno
        let chargeStatus = null;
        try {
          const charge = await getCharge(split.pagarme_charge_id);
          chargeStatus = charge.status;
        } catch (err) {
          console.warn(`[BOOKINGS/CANCEL] falha ao consultar split charge ${split.pagarme_charge_id}:`, err.message);
        }

        if (chargeStatus === 'refunded' || chargeStatus === 'chargedback') {
          console.log(`[BOOKINGS/CANCEL] split ${split.id} charge já "${chargeStatus}" — duplo estorno evitado`);
          continue;
        }
        if (chargeStatus && chargeStatus !== 'paid') {
          console.log(`[BOOKINGS/CANCEL] split ${split.id} charge "${chargeStatus}" — estorno ignorado`);
          continue;
        }

        // Sempre envia centavos explícitos — nunca null
        const refundCents = info.requires_fee
          ? Math.round(split.amount * (100 - feePct) / 100)
          : split.amount; // split.amount já está em centavos (Int no schema)

        console.log(`[BOOKINGS/CANCEL] estornando split ${split.id} | charge=${split.pagarme_charge_id} | amountCents=${refundCents}`);

        try {
          await cancelCharge(split.pagarme_charge_id, refundCents);
          await prisma.bookingPaymentSplit.update({
            where: { id: split.id },
            data:  { status: 'ESTORNADO', updated_at: new Date() },
          });
          console.log(`[BOOKINGS/CANCEL] split ${split.id} estornado com sucesso — R$${(refundCents / 100).toFixed(2)}`);
          pagarmeRefundRequested = true;
        } catch (refundErr) {
          console.error(`[BOOKINGS/CANCEL] falha ao estornar split ${split.id}:`, refundErr.message);
          splitErrors++;
        }
      }

      // Se havia splits pagos e NENHUM foi estornado com sucesso → não cancela o booking
      if (splitsPagas.length > 0 && splitErrors > 0 && !pagarmeRefundRequested) {
        return res.status(502).json({ ok: false, error: 'Falha ao solicitar estorno na Pagar.me' });
      }

      // ── Fallback: nenhum split estava PAGO mas o booking tem charge direta ──
      // Isso acontece quando o pagamento foi feito diretamente (PIX do booking)
      // mesmo que haja um payment_group sem splits quitados.
      if (splitsPagas.length === 0 && booking.pagarme_charge_id && booking.paid_amount > 0) {
        const isPaid = ['PAGO', 'SINAL_PAGO', 'PARCIAL'].includes(originalStatus);

        if (isPaid) {
          let chargeStatus = null;
          try {
            const charge = await getCharge(booking.pagarme_charge_id);
            chargeStatus = charge.status;
            console.log(`[BOOKINGS/CANCEL] fallback direto — charge ${booking.pagarme_charge_id} status="${chargeStatus}"`);
          } catch (err) {
            console.warn(`[BOOKINGS/CANCEL] falha ao consultar charge ${booking.pagarme_charge_id}:`, err.message);
          }

          if (chargeStatus === 'refunded' || chargeStatus === 'chargedback') {
            console.log(`[BOOKINGS/CANCEL] charge já "${chargeStatus}" — duplo estorno evitado`);
          } else if (chargeStatus && chargeStatus !== 'paid') {
            console.log(`[BOOKINGS/CANCEL] charge "${chargeStatus}" (não pago) — estorno ignorado`);
          } else {
            const refundCents = Math.round(info.refund_amount * 100);
            console.log(`[BOOKINGS/CANCEL] fallback direto — estornando charge=${booking.pagarme_charge_id} | amountCents=${refundCents}`);
            try {
              await cancelCharge(booking.pagarme_charge_id, refundCents);
              console.log(`[BOOKINGS/CANCEL] charge ${booking.pagarme_charge_id} estornada (fallback) — R$${(refundCents / 100).toFixed(2)}`);
              pagarmeRefundRequested = true;
              refundedChargeId       = booking.pagarme_charge_id;
            } catch (refundErr) {
              console.error(`[BOOKINGS/CANCEL] falha ao estornar charge ${booking.pagarme_charge_id} (fallback):`, refundErr.message);
              return res.status(502).json({ ok: false, error: 'Falha ao solicitar estorno na Pagar.me' });
            }
          }
        }
      }

    // ── Fluxo direto: estorna a charge individual da reserva ─────────────────
    } else if (booking.pagarme_charge_id && booking.paid_amount > 0) {

      const isPaid = ['PAGO', 'SINAL_PAGO', 'PARCIAL'].includes(originalStatus);

      if (!isPaid) {
        // Reserva sem pagamento real (PENDENTE) — cancela sem precisar chamar Pagar.me
        console.log(`[BOOKINGS/CANCEL] booking ${booking.id} status="${originalStatus}" — sem pagamento real, estorno ignorado`);
      } else {

        // Verifica status na Pagar.me para evitar duplo estorno
        let chargeStatus = null;
        try {
          const charge = await getCharge(booking.pagarme_charge_id);
          chargeStatus = charge.status;
          console.log(`[BOOKINGS/CANCEL] charge ${booking.pagarme_charge_id} status="${chargeStatus}"`);
        } catch (err) {
          console.warn(`[BOOKINGS/CANCEL] falha ao consultar charge ${booking.pagarme_charge_id}:`, err.message);
        }

        if (chargeStatus === 'refunded' || chargeStatus === 'chargedback') {
          // Já estornada/contestada na Pagar.me — seguro cancelar no banco sem novo estorno
          console.log(`[BOOKINGS/CANCEL] charge já "${chargeStatus}" — duplo estorno evitado`);
        } else if (chargeStatus && chargeStatus !== 'paid') {
          // Nunca foi paga na Pagar.me — cancela sem estorno
          console.log(`[BOOKINGS/CANCEL] charge "${chargeStatus}" (não pago) — estorno ignorado`);
        } else {

          // Sempre envia centavos explícitos — nunca null
          // refund_amount já desconta a taxa quando requires_fee=true; quando false, é igual a paid_amount
          const refundCents = Math.round(info.refund_amount * 100);

          console.log(`[BOOKINGS/CANCEL] estornando charge=${booking.pagarme_charge_id} | amountCents=${refundCents}`);

          try {
            await cancelCharge(booking.pagarme_charge_id, refundCents);
            console.log(`[BOOKINGS/CANCEL] charge ${booking.pagarme_charge_id} estornada com sucesso — R$${(refundCents / 100).toFixed(2)}`);
            pagarmeRefundRequested = true;
            refundedChargeId       = booking.pagarme_charge_id;
          } catch (refundErr) {
            // Pagar.me falhou — NÃO atualiza o banco, retorna erro controlado ao frontend
            console.error(`[BOOKINGS/CANCEL] falha ao estornar charge ${booking.pagarme_charge_id}:`, refundErr.message);
            return res.status(502).json({ ok: false, error: 'Falha ao solicitar estorno na Pagar.me' });
          }
        }
      }
    }

    // ── Atualiza banco somente aqui — após estorno bem-sucedido (ou sem pagamento) ──
    // Se houve estorno na Pagar.me → CANCELADO (aguarda confirmação via charge.refunded → ESTORNADO)
    // Se não houve pagamento real   → CANCELADO
    const canceledAt = new Date();
    await prisma.booking.update({
      where: { id: booking.id },
      data:  { payment_status: 'CANCELADO', canceled_at: canceledAt, updated_at: canceledAt },
    });

    const refundAmountCents = Math.round(info.refund_amount * 100);

    console.log(`[BOOKINGS/CANCEL] ${booking.id} → CANCELADO | reason=${info.reason} | fee=R$${info.fee_amount} | refund=R$${info.refund_amount} | pagarme_requested=${pagarmeRefundRequested}`);

    return res.json({
      ok:                       true,
      requires_fee:             info.requires_fee,
      hours_remaining:          info.hours_remaining,
      fee_amount:               info.fee_amount,
      refund_amount:            info.refund_amount,
      refund_amount_cents:      refundAmountCents,
      reason:                   info.reason,
      pagarme_refund_requested: pagarmeRefundRequested,
      pagarme_charge_id:        refundedChargeId ?? booking.pagarme_charge_id ?? null,
    });
  } catch (err) {
    console.error('[BOOKINGS/CANCEL]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/bookings/:id/pay-balance
 * Gera um novo PIX para o saldo restante de uma reserva com entrada de 50%.
 * Só funciona para bookings com payment_status = SINAL_PAGO e payment_option = '50'.
 */
async function payBalance(req, res) {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id, user_uid: req.user.firebase_uid },
      include: {
        court: { include: { establishment: { include: { financial: true } } } },
      },
    });

    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada' });

    if (booking.payment_status !== 'SINAL_PAGO') {
      return res.status(409).json({ error: 'Esta reserva não possui saldo pendente para pagamento' });
    }

    if (booking.payment_option !== '50') {
      return res.status(409).json({ error: 'Esta reserva não é do tipo entrada (50%)' });
    }

    const remainingReais = Number(booking.total_amount) - Number(booking.paid_amount);
    const amountCents    = Math.round(remainingReais * 100);

    if (amountCents < 100) {
      return res.status(409).json({ error: 'Saldo restante muito pequeno (mínimo R$1,00)' });
    }

    const recipientId = booking.court.establishment.financial?.pagarme_recipient_id || null;

    let pixData = { orderId: null, chargeId: null, qrCode: null, qrCodeUrl: null, expiresAt: null };
    try {
      pixData = await createOrder({
        amountCents,
        recipientId,
        description:      `Saldo restante — ${booking.court.name} (${booking.date} ${booking.start_hour}–${booking.end_hour})`,
        customerName:     booking.client_name,
        customerEmail:    req.user?.email || 'cliente@arenaflow.app',
        customerDocument: '',
        customerPhone:    booking.client_phone || '',
      });
    } catch (pixErr) {
      console.error('[BOOKINGS/PAY_BALANCE] Erro ao gerar PIX:', pixErr.message);
      return res.status(502).json({ error: 'Erro ao gerar PIX do saldo. Tente novamente.' });
    }

    // Atualiza a reserva com os novos dados do PIX do saldo
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        pagarme_order_id:  pixData.orderId  || booking.pagarme_order_id,
        pagarme_charge_id: pixData.chargeId || booking.pagarme_charge_id,
        pix_qr_code:       pixData.qrCode    || null,
        pix_qr_code_url:   pixData.qrCodeUrl || null,
        pix_expires_at:    pixData.expiresAt ? new Date(pixData.expiresAt) : null,
        updated_at:        new Date(),
      },
    });

    console.log(`[BOOKINGS/PAY_BALANCE] ${booking.id} → PIX saldo R$${(amountCents / 100).toFixed(2)} gerado | charge=${pixData.chargeId}`);

    return res.json({
      remaining_amount:   remainingReais,
      pix_qr_code:        pixData.qrCode,
      pix_qr_code_url:    pixData.qrCodeUrl,
      pix_expires_at:     pixData.expiresAt,
      pagarme_order_id:   pixData.orderId,
      pagarme_charge_id:  pixData.chargeId,
    });

  } catch (err) {
    console.error('[BOOKINGS/PAY_BALANCE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { create, getById, getMyBookings, simulatePayment, getAvailability, getCancelPreview, cancel, payBalance };
