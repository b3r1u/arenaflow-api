const prisma = require('../lib/prisma');

// Mapa de status ASAAS → status interno
const STATUS_MAP = {
  ACTIVE:    'ACTIVE',
  APPROVED:  'ACTIVE',
  INACTIVE:  'SUSPENDED',
  REJECTED:  'SUSPENDED',
  SUSPENDED: 'SUSPENDED',
};

// POST /api/webhook/asaas
async function asaasWebhook(req, res) {
  // Valida token configurado no painel ASAAS
  const token = req.headers['asaas-access-token'];
  if (process.env.ASAAS_WEBHOOK_TOKEN && token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const { event, account } = req.body;

  console.log('[ASAAS Webhook]', event, JSON.stringify(account ?? {}));

  // Eventos de mudança de status da subconta
  const accountEvents = [
    'ACCOUNT_STATUS_CHANGED',
    'ACCOUNT_APPROVED',
    'ACCOUNT_REJECTED',
  ];

  if (!accountEvents.includes(event) || !account?.walletId) {
    // Evento não relevante — responde 200 para o ASAAS não retentar
    return res.json({ received: true });
  }

  const asaasStatus = account.status?.toUpperCase();
  const newStatus   = STATUS_MAP[asaasStatus];

  if (!newStatus) {
    return res.json({ received: true });
  }

  try {
    const financial = await prisma.financialInfo.findFirst({
      where: { asaas_account_id: account.walletId },
    });

    if (!financial) {
      console.warn('[ASAAS Webhook] walletId não encontrado:', account.walletId);
      return res.json({ received: true });
    }

    if (financial.status !== newStatus) {
      await prisma.financialInfo.update({
        where: { id: financial.id },
        data:  { status: newStatus, updated_at: new Date() },
      });
      console.log(`[ASAAS Webhook] ${financial.id}: ${financial.status} → ${newStatus}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[ASAAS Webhook] Erro ao atualizar status:', err.message);
    // Retorna 200 mesmo assim — evita que o ASAAS entre em loop de retentativas
    res.json({ received: true });
  }
}

module.exports = { asaasWebhook };
