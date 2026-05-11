/**
 * Middleware de autenticação de webhooks do Pagar.me via HTTP Basic Auth.
 *
 * O Pagar.me V5 envia as credenciais configuradas no dashboard em cada requisição:
 *   Authorization: Basic <base64(usuario:senha)>
 *
 * Variáveis de ambiente necessárias:
 *   PAGARME_WEBHOOK_USER  — usuário configurado no dashboard Pagar.me → Webhooks → Autenticação
 *   PAGARME_WEBHOOK_PASS  — senha configurada no dashboard Pagar.me → Webhooks → Autenticação
 *
 * Em desenvolvimento sem as variáveis configuradas: aviso + bypass.
 * Em produção (NODE_ENV=production) sem as variáveis: bloqueia com 503.
 */
function validateWebhookSignature(req, res, next) {
  const expectedUser = process.env.PAGARME_WEBHOOK_USER;
  const expectedPass = process.env.PAGARME_WEBHOOK_PASS;

  // Sem credenciais configuradas: bloqueia em produção, avisa em dev
  if (!expectedUser || !expectedPass) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[WEBHOOK-AUTH] PAGARME_WEBHOOK_USER/PASS não configurados — requisição recusada');
      return res.status(503).json({ error: 'Webhook não configurado' });
    }
    console.warn('[WEBHOOK-AUTH] Credenciais de webhook ausentes — autenticação desabilitada (dev)');
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    console.warn('[WEBHOOK-AUTH] Header Authorization ausente ou não-Basic');
    return res.status(401).json({ error: 'Autenticação de webhook ausente' });
  }

  // Decodifica "Basic <base64>"
  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ error: 'Autenticação de webhook inválida' });
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    return res.status(401).json({ error: 'Autenticação de webhook inválida' });
  }

  const receivedUser = decoded.slice(0, colonIdx);
  const receivedPass = decoded.slice(colonIdx + 1);

  // Comparação segura contra timing attacks
  const crypto = require('crypto');

  const userMatch = safeCompare(receivedUser, expectedUser);
  const passMatch = safeCompare(receivedPass, expectedPass);

  if (!userMatch || !passMatch) {
    console.warn('[WEBHOOK-AUTH] Credenciais de webhook inválidas');
    return res.status(401).json({ error: 'Autenticação de webhook inválida' });
  }

  next();
}

/** Compara duas strings de forma segura contra timing attacks */
function safeCompare(a, b) {
  const crypto = require('crypto');
  // Garante tamanho igual antes do timingSafeEqual
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Faz a comparação mesmo assim para não vazar timing, mas retorna false
    crypto.timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { validateWebhookSignature };
