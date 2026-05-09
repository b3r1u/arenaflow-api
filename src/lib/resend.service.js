const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envia email de suporte para a equipe ArenaFlow/Solve.
 * @param {object} opts
 * @param {string} opts.establishmentName - Nome do estabelecimento
 * @param {string} opts.senderEmail       - Email do usuário logado
 * @param {string} opts.message           - Mensagem do usuário
 */
async function sendSupportEmail({ establishmentName, senderEmail, message }) {
  const to   = process.env.SUPPORT_EMAIL || 'connectsolve.ti@gmail.com';
  const from = 'Suporte ArenaFlow <onboarding@resend.dev>';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:24px 28px">
        <h1 style="margin:0;color:white;font-size:18px;font-weight:700">📬 Novo chamado de suporte</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px">ArenaFlow — Painel Admin</p>
      </div>

      <!-- Body -->
      <div style="padding:28px">

        <!-- Estabelecimento -->
        <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;border:1px solid #e5e7eb">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280">Estabelecimento</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#111827">${establishmentName}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${senderEmail}</p>
        </div>

        <!-- Mensagem -->
        <div style="background:white;border-radius:8px;padding:16px 20px;border:1px solid #e5e7eb">
          <p style="margin:0 0 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280">Mensagem</p>
          <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.6;white-space:pre-wrap">${message}</p>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding:16px 28px;background:#f3f4f6;border-top:1px solid #e5e7eb">
        <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">Enviado via ArenaFlow · ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      </div>

    </div>
  `;

  return resend.emails.send({
    from,
    to,
    subject: `[Suporte] ${establishmentName}`,
    html,
  });
}

module.exports = { sendSupportEmail };
