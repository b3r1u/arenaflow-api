const crypto = require('crypto');

/**
 * Middleware de autenticação de webhooks do Pagar.me via HMAC-SHA256.
 *
 * O Pagar.me V5 assina cada requisição de webhook com o segredo configurado
 * no dashboard e envia a assinatura no header `x-hub-signature`:
 *   x-hub-signature: sha256=<hmac-sha256-hex>
 *
 * IMPORTANTE: req.rawBody deve estar disponível (configurado em app.js via
 * `verify` callback do express.json).
 *
 * Variável de ambiente necessária:
 *   PAGARME_WEBHOOK_SECRET — obter em: Pagar.me Dashboard → Configurações → Webhooks
 *
 * Em desenvolvimento sem a variável configurada, a validação é ignorada com aviso.
 * Em produção (NODE_ENV=production) sem a variável, a requisição é recusada com 503.
 */
function validateWebhookSignature(req, res, next) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;

  // Sem secret configurado: bloqueia em produção, avisa em dev
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[WEBHOOK-AUTH] PAGARME_WEBHOOK_SECRET não configurado — requisição recusada');
      return res.status(503).json({ error: 'Webhook não configurado' });
    }
    console.warn('[WEBHOOK-AUTH] PAGARME_WEBHOOK_SECRET ausente — validação de assinatura desabilitada (dev)');
    return next();
  }

  const signatureHeader = req.headers['x-hub-signature'];

  if (!signatureHeader) {
    console.warn('[WEBHOOK-AUTH] Header x-hub-signature ausente');
    return res.status(401).json({ error: 'Assinatura de webhook ausente' });
  }

  // Extrai o hash (formato: "sha256=<hex>")
  const [algo, receivedHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !receivedHex) {
    console.warn('[WEBHOOK-AUTH] Formato de assinatura inválido:', signatureHeader);
    return res.status(401).json({ error: 'Formato de assinatura inválido' });
  }

  // Body cru necessário para verificação correta do HMAC
  const rawBody = req.rawBody;
  if (!rawBody) {
    console.error('[WEBHOOK-AUTH] req.rawBody indisponível — verifique configuração do express.json em app.js');
    return res.status(500).json({ error: 'Configuração de servidor incorreta' });
  }

  // Calcula o HMAC esperado usando timingSafeEqual para evitar timing attacks
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHmac, 'hex');

  // Buffers de tamanho diferente indicam adulteração — recusa antes do compare
  if (receivedBuf.length !== expectedBuf.length) {
    console.warn('[WEBHOOK-AUTH] Assinatura de webhook inválida (tamanho diferente)');
    return res.status(401).json({ error: 'Assinatura de webhook inválida' });
  }

  const isValid = crypto.timingSafeEqual(receivedBuf, expectedBuf);

  if (!isValid) {
    console.warn('[WEBHOOK-AUTH] Assinatura de webhook inválida (hash não confere)');
    return res.status(401).json({ error: 'Assinatura de webhook inválida' });
  }

  next();
}

module.exports = { validateWebhookSignature };
