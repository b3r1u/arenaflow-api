/**
 * Serviço de Audit Log — ArenaFlow API (L3)
 *
 * Registra ações críticas com contexto estruturado.
 * Saída via console.log com prefixo [AUDIT] — capturado pelo Railway/logs.
 *
 * Eventos auditados:
 *  - booking.created       — nova reserva criada
 *  - booking.cancelled     — cancelamento com ou sem estorno
 *  - booking.paid          — confirmação de pagamento via webhook
 *  - split.paid            — cota de pagamento confirmada
 *  - payment_group.created — grupo de pagamento criado
 *  - subscription.changed  — mudança de status de assinatura
 *  - auth.platform_access  — acesso a rota de plataforma (admin)
 *
 * Estrutura de cada linha:
 *  [AUDIT] <ISO_DATE> | action=<action> | actor=<uid_or_ip> | resource=<id> | meta=<json>
 */

/**
 * @param {string} action      — nome do evento (ex: 'booking.cancelled')
 * @param {string} actor       — quem executou (firebase_uid, 'webhook', 'system', IP)
 * @param {string} resourceId  — ID do recurso afetado (booking.id, subscription.id, etc.)
 * @param {object} [meta]      — dados extras relevantes (sem dados sensíveis)
 */
function auditLog(action, actor, resourceId, meta = {}) {
  const entry = {
    ts:         new Date().toISOString(),
    action,
    actor,
    resource:   resourceId,
    ...meta,
  };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}

module.exports = { auditLog };
