const prisma  = require('../lib/prisma');
const { createPlayerPixOrder, getCharge } = require('../lib/pagarme.service');

/**
 * POST /api/bookings/:id/payment-group
 *
 * Cria um grupo de pagamento para uma reserva.
 *
 * Body SPLIT (100% dividido entre jogadores):
 * {
 *   payment_type: "SPLIT",
 *   players: [
 *     { name: "Roberio", email: "r@r.com", document: "000.000.000-00" },
 *     { name: "João" },
 *     ...
 *   ]
 * }
 *
 * Body DEPOSIT (50% de sinal):
 * {
 *   payment_type: "DEPOSIT",
 *   player_name: "Roberio",
 *   player_email: "r@r.com",
 *   player_document: "000.000.000-00"
 * }
 */
async function createPaymentGroup(req, res) {
  const { id: bookingId } = req.params;
  const { payment_type, players, player_name, player_email, player_document } = req.body;

  if (!payment_type || !['SPLIT', 'DEPOSIT'].includes(payment_type)) {
    return res.status(400).json({ error: 'payment_type deve ser SPLIT ou DEPOSIT' });
  }

  if (payment_type === 'SPLIT' && (!Array.isArray(players) || players.length < 2)) {
    return res.status(400).json({ error: 'SPLIT requer pelo menos 2 jogadores em players[]' });
  }

  try {
    // 1. Busca a reserva
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, user_uid: req.user.firebase_uid },
      include: {
        court: { include: { establishment: { include: { financial: true } } } },
        payment_group: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Reserva não encontrada' });
    }
    if (booking.payment_group) {
      return res.status(409).json({ error: 'Esta reserva já possui um grupo de pagamento' });
    }

    const totalCents     = Math.round(booking.total_amount * 100);
    const recipientId    = booking.court.establishment.financial?.pagarme_recipient_id || null;
    const arenaDesc      = `${booking.court.name} — ${booking.date} ${booking.start_hour}–${booking.end_hour}`;

    // CPF fallback: usa o do dono da reserva (user logado) — Pagar.me em produção rejeita CPF zerado por antifraude
    const userRow = await prisma.user.findUnique({ where: { firebase_uid: req.user.firebase_uid } });
    const fallbackDoc = (userRow?.cpf || '').replace(/\D/g, '') || null;

    // 2. Calcula cotas em centavos
    let splitItems = [];

    if (payment_type === 'SPLIT') {
      const n         = players.length;
      const baseValue = Math.floor(totalCents / n);
      const remainder = totalCents - baseValue * n;

      splitItems = players.map((p, i) => ({
        player_name:     p.name    || `Jogador ${i + 1}`,
        player_email:    p.email   || req.user?.email || null,
        player_document: (p.document || '').replace(/\D/g, '') || fallbackDoc,
        amount:          i === n - 1 ? baseValue + remainder : baseValue, // última cota absorve o centavo
      }));
    } else {
      // DEPOSIT — 50%
      const depositCents = Math.round(totalCents / 2);
      splitItems = [{
        player_name:     player_name     || booking.client_name || 'Cliente',
        player_email:    player_email    || req.user?.email     || null,
        player_document: (player_document || '').replace(/\D/g, '') || fallbackDoc,
        amount:          depositCents,
      }];
    }

    if (!fallbackDoc && splitItems.some(s => !s.player_document)) {
      return res.status(400).json({
        error: 'CPF não informado. Cadastre seu CPF no perfil ou informe o CPF de cada jogador.',
      });
    }

    // 2b. Valida valor mínimo por cota (Pagar.me exige mínimo R$1,00 por PIX)
    const minAmount = Math.min(...splitItems.map(s => s.amount));
    if (minAmount < 100) {
      const minReais = (100 / 100).toFixed(2);
      const actualReais = (minAmount / 100).toFixed(2);
      return res.status(400).json({
        error: `Valor mínimo por cota é R$${minReais}. Valor calculado: R$${actualReais}. Aumente o valor da reserva ou reduza o número de jogadores.`,
      });
    }

    // 3. Cria o grupo no banco
    const group = await prisma.bookingPaymentGroup.create({
      data: {
        booking_id:   bookingId,
        payment_type,
        total_amount: payment_type === 'SPLIT' ? totalCents : Math.round(totalCents / 2),
        paid_amount:  0,
        status:       'PENDENTE',
      },
    });

    // 4. Para cada cota: chama o Pagar.me e salva no banco
    const splitResults = [];

    for (const item of splitItems) {
      let pixData = { orderId: null, chargeId: null, qrCode: null, qrCopyPaste: null, expiresAt: null };

      try {
        pixData = await createPlayerPixOrder({
          amountCents:    item.amount,
          description:    `[${payment_type === 'SPLIT' ? `Cota de ${item.player_name}` : 'Sinal 50%'}] ${arenaDesc}`,
          playerName:     item.player_name,
          playerEmail:    item.player_email,
          playerDocument: item.player_document,
          recipientId,
        });
      } catch (pixErr) {
        console.error(`[PAYMENT] Erro ao criar Pix para ${item.player_name}:`, pixErr.message);
        // Continua — registra a cota sem Pix, pode ser retentado depois
      }

      const split = await prisma.bookingPaymentSplit.create({
        data: {
          group_id:          group.id,
          player_name:       item.player_name,
          amount:            item.amount,
          pagarme_order_id:  pixData.orderId,
          pagarme_charge_id: pixData.chargeId,
          pix_qr_code:       pixData.qrCode,
          pix_copy_paste:    pixData.qrCopyPaste,
          pix_expires_at:    pixData.expiresAt ? new Date(pixData.expiresAt) : null,
          status:            'PENDENTE',
        },
      });

      splitResults.push(split);
    }

    // 5. Atualiza status da reserva para PENDENTE (aguardando pagamento)
    await prisma.booking.update({
      where: { id: bookingId },
      data:  { payment_status: 'PENDENTE' },
    });

    return res.status(201).json({
      group: {
        id:           group.id,
        payment_type: group.payment_type,
        total_amount: group.total_amount,
        paid_amount:  group.paid_amount,
        status:       group.status,
        splits:       splitResults.map(s => ({
          id:            s.id,
          player_name:   s.player_name,
          amount:        s.amount,
          pix_qr_code:   s.pix_qr_code,
          pix_copy_paste: s.pix_copy_paste,
          pix_expires_at: s.pix_expires_at,
          status:        s.status,
        })),
      },
    });

  } catch (err) {
    console.error('[PAYMENT/CREATE_GROUP]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/bookings/:id/payment-group
 * Retorna o grupo de pagamento e cotas de uma reserva (autenticado).
 * Para cada split PENDENTE, consulta o Pagar.me e sincroniza status on-demand.
 * Isso garante atualização mesmo quando o webhook não chega (dev, ngrok offline etc).
 */
async function getPaymentGroup(req, res) {
  const { id: bookingId } = req.params;

  try {
    const group = await prisma.bookingPaymentGroup.findUnique({
      where:   { booking_id: bookingId },
      include: { splits: { orderBy: { created_at: 'asc' } } },
    });

    if (!group) {
      return res.status(404).json({ error: 'Grupo de pagamento não encontrado' });
    }

    // Sincroniza splits PENDENTES com status real do Pagar.me
    const pendentes = group.splits.filter(s => s.status === 'PENDENTE' && s.pagarme_charge_id);

    for (const split of pendentes) {
      try {
        const charge = await getCharge(split.pagarme_charge_id);
        if (charge.status === 'paid') {
          // Atualiza split
          await prisma.bookingPaymentSplit.update({
            where: { id: split.id },
            data:  { status: 'PAGO', updated_at: new Date() },
          });
          split.status = 'PAGO'; // atualiza objeto em memória para resposta

          // Recalcula grupo
          const newPaid   = group.paid_amount + split.amount;
          const groupPago = newPaid >= group.total_amount;
          await prisma.bookingPaymentGroup.update({
            where: { id: group.id },
            data: {
              paid_amount: newPaid,
              status:      groupPago ? 'PAGO' : 'PARCIAL',
              updated_at:  new Date(),
            },
          });
          group.paid_amount = newPaid;
          group.status      = groupPago ? 'PAGO' : 'PARCIAL';

          // Atualiza booking
          const bookingStatus = groupPago ? 'PAGO' : 'PARCIAL';
          await prisma.booking.update({
            where: { id: bookingId },
            data: {
              payment_status: bookingStatus,
              paid_amount:    newPaid / 100,
              updated_at:     new Date(),
            },
          });

          console.log(`[PAYMENT/SYNC] Split ${split.player_name} → PAGO (via polling Pagar.me)`);
        }
      } catch (syncErr) {
        console.warn(`[PAYMENT/SYNC] Erro ao verificar charge ${split.pagarme_charge_id}:`, syncErr.message);
      }
    }

    return res.json({ group });
  } catch (err) {
    console.error('[PAYMENT/GET_GROUP]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/bookings/:id/splits/:splitId/regenerate
 * Regenera o QR Code PIX de uma cota expirada ou falha.
 * Apenas o dono da reserva pode regenerar.
 */
async function regenerateSplit(req, res) {
  const { id: bookingId, splitId } = req.params;

  try {
    // Valida que a reserva pertence ao usuário
    const booking = await prisma.booking.findFirst({
      where:   { id: bookingId, user_uid: req.user.firebase_uid },
      include: {
        court: { include: { establishment: { include: { financial: true } } } },
      },
    });
    if (!booking) return res.status(404).json({ error: 'Reserva não encontrada' });

    // Busca a cota
    const split = await prisma.bookingPaymentSplit.findFirst({
      where: { id: splitId, group: { booking_id: bookingId } },
      include: { group: true },
    });
    if (!split) return res.status(404).json({ error: 'Cota não encontrada' });
    if (split.status === 'PAGO') return res.status(409).json({ error: 'Cota já foi paga' });

    const recipientId = booking.court.establishment.financial?.pagarme_recipient_id || null;
    const arenaDesc   = `${booking.court.name} — ${booking.date} ${booking.start_hour}–${booking.end_hour}`;

    // Cria novo order no Pagar.me
    const pixData = await createPlayerPixOrder({
      amountCents:    split.amount,
      description:    `[Cota de ${split.player_name}] ${arenaDesc}`,
      playerName:     split.player_name,
      playerEmail:    null,
      playerDocument: null,
      recipientId,
    });

    // Atualiza a cota com o novo QR
    const updated = await prisma.bookingPaymentSplit.update({
      where: { id: splitId },
      data: {
        pagarme_order_id:  pixData.orderId,
        pagarme_charge_id: pixData.chargeId,
        pix_qr_code:       pixData.qrCode,
        pix_copy_paste:    pixData.qrCopyPaste,
        pix_expires_at:    pixData.expiresAt ? new Date(pixData.expiresAt) : null,
        status:            'PENDENTE',
        updated_at:        new Date(),
      },
    });

    console.log(`[PAYMENT/REGEN] Cota ${split.player_name} regenerada → order ${pixData.orderId}`);

    return res.json({
      split: {
        id:             updated.id,
        player_name:    updated.player_name,
        amount:         updated.amount,
        pix_qr_code:    updated.pix_qr_code,
        pix_copy_paste: updated.pix_copy_paste,
        pix_expires_at: updated.pix_expires_at,
        status:         updated.status,
      },
    });
  } catch (err) {
    console.error('[PAYMENT/REGEN]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { createPaymentGroup, getPaymentGroup, regenerateSplit };
