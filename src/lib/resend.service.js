const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envia email de suporte para a equipe ArenaFlow/Solve.
 * @param {object} opts
 * @param {string|null} opts.establishmentName - Nome do estabelecimento (gestores)
 * @param {string|null} opts.clientName        - Nome do cliente (booking)
 * @param {string|null} opts.clientPhone       - Telefone/WhatsApp do cliente (booking)
 * @param {string}      opts.senderEmail       - Email do remetente
 * @param {string}      opts.message           - Mensagem
 */
async function sendSupportEmail({ establishmentName, clientName, clientPhone, senderEmail, message }) {
  const to      = process.env.SUPPORT_EMAIL || 'connectsolve.ti@gmail.com';
  const from    = 'Suporte ArenaFlow <noreply@arenaflow.site>';
  const isAdmin = !!establishmentName;

  const senderBlock = isAdmin
    ? `
        <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;border:1px solid #e5e7eb">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280">Estabelecimento</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#111827">${establishmentName}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${senderEmail}</p>
        </div>`
    : `
        <div style="background:white;border-radius:8px;padding:16px 20px;margin-bottom:16px;border:1px solid #e5e7eb">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280">Chamado app booking</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#111827">${clientName || 'Cliente'}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${senderEmail}</p>
          ${clientPhone ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">📱 WhatsApp: ${clientPhone}</p>` : ''}
        </div>`;

  const subject = isAdmin
    ? `[Suporte Admin] ${establishmentName}`
    : `[Suporte Booking] ${clientName || senderEmail}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:24px 28px">
        <h1 style="margin:0;color:white;font-size:18px;font-weight:700">📬 Novo chamado de suporte</h1>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px">ArenaFlow — ${isAdmin ? 'Painel Admin' : 'App Booking'}</p>
      </div>

      <!-- Body -->
      <div style="padding:28px">

        ${senderBlock}

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

  return resend.emails.send({ from, to, subject, html });
}

/**
 * Envia email de confirmação de reserva para o cliente.
 * @param {object} opts
 * @param {string} opts.clientEmail    - Email do cliente
 * @param {string} opts.clientName     - Nome do cliente
 * @param {string} opts.arenaName      - Nome da arena
 * @param {string} opts.courtName      - Nome da quadra
 * @param {string} opts.date           - Data da reserva (YYYY-MM-DD)
 * @param {string} opts.startHour      - Hora início (HH:00)
 * @param {string} opts.endHour        - Hora fim (HH:00)
 * @param {number} opts.totalAmount    - Valor total pago
 */
async function sendBookingConfirmationEmail({ clientEmail, clientName, arenaName, courtName, date, startHour, endHour, totalAmount }) {
  const from = 'ArenaFlow <noreply@arenaflow.site>';

  // Formata data: YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = date.split('-');
  const dateFormatted = `${day}/${month}/${year}`;

  const amountFormatted = Number(totalAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:28px">
        <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:48px;height:48px;text-align:center;line-height:48px;font-size:24px;margin-bottom:12px">✅</div>
        <h1 style="margin:0;color:white;font-size:22px;font-weight:700">Reserva confirmada!</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Seu pagamento foi recebido com sucesso.</p>
      </div>

      <!-- Body -->
      <div style="padding:28px">

        <p style="margin:0 0 20px;font-size:15px;color:#374151">Olá, <strong>${clientName}</strong>! Sua reserva está confirmada. Veja os detalhes abaixo:</p>

        <!-- Card de detalhes -->
        <div style="background:white;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:20px">

          <div style="background:#f0fdf4;padding:14px 20px;border-bottom:1px solid #e5e7eb">
            <p style="margin:0;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em">📍 ${arenaName}</p>
          </div>

          <table style="width:100%;border-collapse:collapse;padding:8px 24px 8px;display:block;box-sizing:border-box">
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:14px 24px 14px 24px;font-size:13px;color:#6b7280;font-weight:500;white-space:nowrap;width:40%">Quadra</td>
              <td style="padding:14px 24px 14px 0;font-size:14px;font-weight:600;color:#111827;text-align:left">${courtName}</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:14px 24px 14px 24px;font-size:13px;color:#6b7280;font-weight:500;white-space:nowrap">Data</td>
              <td style="padding:14px 24px 14px 0;font-size:14px;font-weight:600;color:#111827;text-align:left">${dateFormatted}</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:14px 24px 14px 24px;font-size:13px;color:#6b7280;font-weight:500;white-space:nowrap">Horário</td>
              <td style="padding:14px 24px 14px 0;font-size:14px;font-weight:600;color:#111827;text-align:left">${startHour} – ${endHour}</td>
            </tr>
            <tr>
              <td style="padding:14px 24px 14px 24px;font-size:13px;color:#6b7280;font-weight:500;white-space:nowrap">Total pago</td>
              <td style="padding:14px 24px 14px 0;font-size:16px;font-weight:700;color:#16a34a;text-align:left">${amountFormatted}</td>
            </tr>
          </table>
        </div>

        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6">
          Guarde este email como comprovante. Em caso de dúvidas, entre em contato com a arena diretamente.
        </p>

      </div>

      <!-- Footer -->
      <div style="padding:16px 28px;background:#f3f4f6;border-top:1px solid #e5e7eb;text-align:center">
        <p style="margin:0;font-size:11px;color:#9ca3af">ArenaFlow · ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      </div>

    </div>
  `;

  return resend.emails.send({
    from,
    to:      clientEmail,
    subject: `✅ Reserva confirmada — ${arenaName} · ${dateFormatted} ${startHour}`,
    html,
  });
}

module.exports = { sendSupportEmail, sendBookingConfirmationEmail };
