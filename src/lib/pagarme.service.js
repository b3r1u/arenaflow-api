const https = require('https');

// ─── Mascaramento de dados sensíveis nos logs (C3) ────────────────────────────
// Campos que NUNCA devem aparecer em texto claro em logs
const SENSITIVE_FIELDS = new Set([
  'document', 'cpf', 'cnpj', 'number', 'cvv', 'holder_document',
  'account_number', 'branch_number', 'branch_check_digit', 'account_check_digit',
  'holder_name', 'email', 'ddd', 'phone',
]);

function maskValue(key, value) {
  if (typeof value !== 'string' || value.length < 3) return '***';
  if (key === 'email') {
    const [u, d] = value.split('@');
    return d ? `${u.slice(0, 2)}***@${d}` : '***';
  }
  if (key === 'number' && value.length >= 12) {
    // Número de cartão: mostra últimos 4
    return `****${value.slice(-4)}`;
  }
  // Documentos e demais: mostra primeiros 3 + ***
  return `${value.slice(0, 3)}***`;
}

function maskObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskObject);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_FIELDS.has(k.toLowerCase()) ? maskValue(k.toLowerCase(), String(v)) : maskObject(v),
    ])
  );
}

function safeLog(method, path, statusCode, rawJson) {
  try {
    const parsed  = JSON.parse(rawJson);
    const masked  = maskObject(parsed);
    const preview = JSON.stringify(masked).slice(0, 400);
    console.log(`[PAGARME] ${method} ${path} → ${statusCode} | ${preview}`);
  } catch {
    // Resposta não-JSON (ex: HTML de erro 5xx do gateway)
    console.log(`[PAGARME] ${method} ${path} → ${statusCode} | (resposta não-JSON, ${rawJson.length} bytes)`);
  }
}

function getBaseUrl() {
  // Pagar.me V5 usa o mesmo endpoint para sandbox e produção.
  // O ambiente é diferenciado pelo prefixo da chave: sk_test_... (sandbox) ou sk_live_... (produção).
  return 'https://api.pagar.me/core/v5';
}

function getAuthHeader() {
  const apiKey = process.env.PAGARME_API_KEY;
  if (!apiKey) throw new Error('PAGARME_API_KEY não configurada');
  return 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = getBaseUrl();
    const url  = new URL(baseUrl + path);
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type':  'application/json',
        'User-Agent':    'ArenaFlow/1.0',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (!raw.trim()) {
          console.log(`[PAGARME] ${method} ${path} → ${res.statusCode} | (sem body)`);
          if (res.statusCode >= 400) return reject(new Error(`Pagar.me error ${res.statusCode}`));
          return resolve({});
        }
        try {
          const json = JSON.parse(raw);
          // Loga versão mascarada — sem CPF, e-mail, dados de cartão ou conta (C3)
          safeLog(method, path, res.statusCode, raw);
          if (res.statusCode >= 400) {
            const errors = Array.isArray(json?.errors)
              ? json.errors.map(e => e.message || JSON.stringify(e)).join(' | ')
              : null;
            const msg = errors || json?.message || `Pagar.me error ${res.statusCode}`;
            return reject(new Error(msg));
          }
          resolve(json);
        } catch {
          reject(new Error(`Pagar.me resposta inválida (${res.statusCode}): ${raw.length} bytes`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function parsePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return {
    ddd:    digits.slice(0, 2),
    number: digits.slice(2),
    type:   digits.length >= 11 ? 'mobile' : 'landline',
  };
}

function toBankAccountType(type) {
  return type === 'CONTA_POUPANCA' ? 'savings' : 'checking';
}

// Converte YYYY-MM-DD → DD/MM/YYYY (formato Pagar.me)
function formatBirthdate(date) {
  if (!date) return null;
  const parts = String(date).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return date;
}

/**
 * Cria um recebedor no Pagar.me com dados pessoais e conta bancária.
 * Retorna o recipient_id (ex: rp_XXXXXXXXXXXXXXXX).
 */
async function createRecipient({
  name, email, document,
  birthdate, companyType,
  motherName, monthlyIncome, professionalOccupation,
  phone,
  address, addressNumber, complement, neighborhood, city, state, postalCode,
  bankCode, bankAccountType, bankAgency, bankAgencyDigit, bankAccount, bankAccountDigit,
}) {
  const rawDoc       = document.replace(/\D/g, '');
  const isIndividual = rawDoc.length === 11;
  const recipientType = isIndividual ? 'individual' : 'company';
  const parsedPhone   = parsePhone(phone);

  // Mapeamento de company_type para corporation_type do Pagar.me
  const corporationTypeMap = {
    MEI:         'MEI',
    LIMITED:     'LTDA',
    INDIVIDUAL:  'EI',
    ASSOCIATION: 'ASSOCIATION',
  };

  // Endereço (usado em PF e PJ)
  const addressObj = address ? {
    street:          address,
    street_number:   addressNumber || 'S/N',
    complementary:   complement    || '',
    neighborhood:    neighborhood  || '',
    city:            city          || '',
    state:           state         || '',
    zip_code:        (postalCode   || '').replace(/\D/g, ''),
    reference_point: complement    || 'Não informado',
  } : undefined;

  const registerInformation = isIndividual
    ? {
        type:     'individual',
        name,
        email,
        document: rawDoc,
        mother_name:             motherName             || 'Não informado',
        monthly_income:          String(monthlyIncome   || '5000'),
        professional_occupation: professionalOccupation || 'Empresário',
        ...(birthdate           ? { birthdate: formatBirthdate(birthdate) } : {}),
        ...(parsedPhone         ? { phone_numbers: [parsedPhone] }          : {}),
        ...(addressObj          ? { address: addressObj }                   : {}),
      }
    : {
        type:             'corporation',
        email,
        document:         rawDoc,
        company_name:     name,
        trading_name:     name,
        annual_revenue:   1200000,
        corporation_type: corporationTypeMap[companyType] || 'LTDA',
        ...(parsedPhone  ? { phone_numbers: [parsedPhone] } : {}),
        ...(addressObj   ? { address: addressObj }          : {}),
      };

  const payload = {
    code: `arenaflow_${rawDoc}`,
    default_bank_account: {
      holder_name:         name,
      holder_type:         isIndividual ? 'individual' : 'company',
      holder_document:     rawDoc,
      bank:                bankCode,
      branch_number:       bankAgency,
      // branch_check_digit só enviado quando preenchido — string vazia causa invalid_parameter no Pagar.me
      ...(bankAgencyDigit ? { branch_check_digit: bankAgencyDigit } : {}),
      account_number:      bankAccount,
      account_check_digit: bankAccountDigit,
      type:                toBankAccountType(bankAccountType),
    },
    transfer_settings: {
      transfer_enabled:  true,
      transfer_interval: 'Daily',
      transfer_day:      0,
    },
    register_information: registerInformation,
  };

  const result = await request('POST', '/recipients', payload);
  return result.id;
}

/**
 * Consulta o status de um recebedor.
 */
async function getRecipient(recipientId) {
  return request('GET', `/recipients/${recipientId}`);
}

/**
 * Atualiza as configurações de transferência automática de um recebedor.
 * @param {string} recipientId
 * @param {{ interval: 'Daily'|'Weekly'|'Monthly', day: number }} settings
 */
async function updateRecipientTransferSettings(recipientId, { interval, day }) {
  return request('PATCH', `/recipients/${recipientId}/transfer-settings`, {
    transfer_enabled:  true,
    transfer_interval: interval,
    transfer_day:      day,
  });
}

/**
 * Cria um pedido PIX no Pagar.me com split para o recebedor da arena.
 * amountCents: valor em centavos (ex: 10000 = R$100,00)
 * recipientId: pagarme_recipient_id do estabelecimento
 * Retorna { orderId, chargeId, qrCode, qrCodeUrl, expiresAt }
 */
async function createOrder({
  amountCents,
  recipientId,
  description,
  customerName,
  customerEmail,
  customerDocument,
  customerPhone,
  commissionPct = 0,
  arenaflowRecipientId = null,
}) {
  // Valida range do commissionPct — protege contra adulteração do banco (H3)
  const pct = Number(commissionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`commissionPct inválido: ${commissionPct}. Deve ser entre 0 e 100.`);
  }

  // Parse phone para formato Pagar.me. Fallback para número sandbox válido.
  const phoneDigits = (customerPhone || '').replace(/\D/g, '');
  const mobilePhone = phoneDigits.length >= 10
    ? {
        country_code: '55',
        area_code:    phoneDigits.slice(0, 2),
        number:       phoneDigits.slice(2),
      }
    : {
        country_code: '55',
        area_code:    '11',
        number:       '999999999',
      };

  // Valida CPF — Pagar.me rejeita CPFs inválidos com action_forbidden (C5)
  const rawDoc = (customerDocument || '').replace(/\D/g, '');
  const isInvalidCpf = !rawDoc || rawDoc.length !== 11 || /^(\d)\1+$/.test(rawDoc);
  if (isInvalidCpf) {
    throw new Error('CPF do cliente inválido ou não informado. Solicite o CPF antes de gerar o pagamento.');
  }
  const customerDoc = rawDoc;

  const payload = {
    items: [{
      amount:      amountCents,
      description: description || 'Reserva de quadra',
      quantity:    1,
    }],
    customer: {
      name:     customerName     || 'Cliente',
      email:    customerEmail    || 'cliente@arenaflow.app',
      document: customerDoc,
      type:     'individual',
      phones: {
        mobile_phone: mobilePhone,
      },
    },
    payments: [{
      payment_method: 'pix',
      pix: { expires_in: 86400 }, // 24h
      // Split: distribui entre arena e ArenaFlow conforme comissão do plano
      ...(recipientId ? {
        split: (arenaflowRecipientId && commissionPct > 0)
          ? [
              {
                recipient_id: recipientId,
                amount:       100 - commissionPct,
                type:         'percentage',
                options: {
                  liable:                true,
                  charge_processing_fee: true,
                  charge_remainder_fee:  true,
                },
              },
              {
                recipient_id: arenaflowRecipientId,
                amount:       commissionPct,
                type:         'percentage',
                options: {
                  liable:                false,
                  charge_processing_fee: false,
                  charge_remainder_fee:  false,
                },
              },
            ]
          : [
              {
                recipient_id: recipientId,
                amount:       100,
                type:         'percentage',
                options: {
                  liable:                true,
                  charge_processing_fee: true,
                  charge_remainder_fee:  true,
                },
              },
            ],
      } : {}),
    }],
  };

  const result = await request('POST', '/orders', payload);

  const charge = result.charges?.[0];
  const tx     = charge?.last_transaction;

  console.log(`[PAGARME] order ${result.id} → ${result.status} | charge ${charge?.id} → ${charge?.status} | split arena=${100 - commissionPct}% arenaflow=${commissionPct}%`);

  return {
    orderId:    result.id,
    chargeId:   charge?.id    || null,
    qrCode:     tx?.qr_code   || null,
    qrCodeUrl:  tx?.qr_code_url || null,
    expiresAt:  tx?.expires_at  || null,
  };
}

/**
 * Cria uma ordem Pix individual para um jogador (cota da reserva).
 * Usado no fluxo de divisão de pagamento entre jogadores.
 * Retorna { orderId, chargeId, qrCode, qrCopyPaste, expiresAt }
 */
async function createPlayerPixOrder({
  amountCents,
  description,
  playerName,
  playerEmail,
  playerDocument,
  recipientId,
  commissionPct = 0,
  arenaflowRecipientId = null,
}) {
  // Valida range do commissionPct (H3)
  const playerPct = Number(commissionPct);
  if (!Number.isFinite(playerPct) || playerPct < 0 || playerPct > 100) {
    throw new Error(`commissionPct inválido: ${commissionPct}. Deve ser entre 0 e 100.`);
  }

  // Valida CPF do jogador — não aceita placeholder ou CPF inválido (C5)
  const rawPlayerDoc   = (playerDocument || '').replace(/\D/g, '');
  const playerDocInvalid = !rawPlayerDoc || rawPlayerDoc.length !== 11 || /^(\d)\1+$/.test(rawPlayerDoc);
  if (playerDocInvalid) {
    throw new Error('CPF do jogador inválido ou não informado. Solicite o CPF antes de gerar o Pix.');
  }
  const doc = rawPlayerDoc;

  const payload = {
    items: [{
      amount:      amountCents,
      description: description || 'Cota de reserva de quadra',
      quantity:    1,
    }],
    customer: {
      name:     playerName  || 'Jogador',
      email:    playerEmail || 'jogador@arenaflow.app',
      document: doc,
      type:     'individual',
      phones: {
        mobile_phone: { country_code: '55', area_code: '11', number: '999999999' },
      },
    },
    payments: [{
      payment_method: 'pix',
      pix: { expires_in: 86400 }, // 24h
      // Split: distribui entre arena e ArenaFlow conforme comissão do plano
      ...(recipientId ? {
        split: (arenaflowRecipientId && commissionPct > 0)
          ? [
              {
                recipient_id: recipientId,
                amount:       100 - commissionPct,
                type:         'percentage',
                options: {
                  liable:                true,
                  charge_processing_fee: true,
                  charge_remainder_fee:  true,
                },
              },
              {
                recipient_id: arenaflowRecipientId,
                amount:       commissionPct,
                type:         'percentage',
                options: {
                  liable:                false,
                  charge_processing_fee: false,
                  charge_remainder_fee:  false,
                },
              },
            ]
          : [
              {
                recipient_id: recipientId,
                amount:       100,
                type:         'percentage',
                options: {
                  liable:                true,
                  charge_processing_fee: true,
                  charge_remainder_fee:  true,
                },
              },
            ],
      } : {}),
    }],
  };

  const result = await request('POST', '/orders', payload);
  const charge = result.charges?.[0];
  const tx     = charge?.last_transaction;

  console.log(`[PAGARME] player order ${result.id} → ${result.status} | charge ${charge?.id} → ${charge?.status} | split arena=${100 - commissionPct}% arenaflow=${commissionPct}%`);

  // Mapeamento Pagar.me V5:
  //   tx.qr_code     = string EMV "Pix copia e cola" (texto)
  //   tx.qr_code_url = URL da imagem do QR Code (renderização visual)
  return {
    orderId:     result.id,
    chargeId:    charge?.id         || null,
    qrCode:      tx?.qr_code_url    || null, // URL da imagem → vai p/ pix_qr_code
    qrCopyPaste: tx?.qr_code        || null, // EMV texto    → vai p/ pix_copy_paste
    expiresAt:   tx?.expires_at     || null,
  };
}

/**
 * Consulta o status de uma charge no Pagar.me.
 * Retorna { id, status, paid_at } — onde status pode ser:
 * 'pending' | 'paid' | 'canceled' | 'failed' | 'overpaid' | 'underpaid'
 */
async function getCharge(chargeId) {
  return request('GET', `/charges/${chargeId}`);
}

/**
 * Cancela (estorna) uma charge no Pagar.me.
 * Para PIX pago, isso dispara um estorno ao pagante.
 *
 * @param {string} chargeId   — ID da charge (ch_XXXXXXXXXXXXXXXXXX)
 * @param {number|null} amountCents — Valor em centavos a estornar.
 *   null ou omitido → estorno integral.
 *   valor parcial   → estorno parcial (a diferença fica com o recebedor).
 */
async function cancelCharge(chargeId, amountCents) {
  const body = (amountCents != null && amountCents > 0)
    ? { amount: amountCents }
    : undefined;
  return request('DELETE', `/charges/${chargeId}`, body);
}

/**
 * Cria um plano de assinatura no Pagar.me.
 * Retorna o objeto do plano criado (com .id = "plan_xxxx").
 *
 * @param {{ name: string, slug: string, priceCents: number, interval?: 'month'|'year', intervalCount?: number }} params
 */
async function createPlan({ name, slug, priceCents, interval = 'month', intervalCount = 1 }) {
  const payload = {
    name,
    description:     `Plano ${name} - ArenaFlow`,
    currency:        'BRL',
    interval,
    interval_count:  intervalCount,
    billing_type:    'prepaid',
    payment_methods: ['credit_card'],
    installments:    [1],
    items: [{
      name:     `${name} - ArenaFlow`,
      quantity: 1,
      pricing_scheme: {
        price:       priceCents,
        scheme_type: 'unit',
      },
    }],
    metadata: { arenaflow_slug: slug },
  };

  return request('POST', '/plans', payload);
}

/**
 * Consulta um plano no Pagar.me pelo ID.
 */
async function getPlan(planId) {
  return request('GET', `/plans/${planId}`);
}

/**
 * Cria uma assinatura recorrente de cartão de crédito no Pagar.me.
 * @param {{ planId, customer: { name, email, document, phone }, card: { number, holder_name, exp_month, exp_year, cvv } }} params
 * Retorna o objeto da assinatura (com .id = "sub_xxxx" e .status).
 */
async function createSubscription({ planId, customer, card, billingAddress }) {
  const phoneDigits = (customer.phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 10) throw new Error('Número de celular inválido ou não informado');
  const mobilePhone = { country_code: '55', area_code: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) };

  const rawDoc = (customer.document || '').replace(/\D/g, '');

  // billing_address é exigido pelo Pagar.me em produção para cobranças recorrentes de cartão
  const rawCep  = (billingAddress?.zip_code || '').replace(/\D/g, '');
  const billing = {
    line_1:   billingAddress?.line_1  || '1',
    zip_code: rawCep                  || '01310100',
    city:     billingAddress?.city    || 'Não informado',
    state:    billingAddress?.state   || 'SP',
    country:  'BR',
  };

  const payload = {
    plan_id:        planId,
    payment_method: 'credit_card',
    customer: {
      name:     customer.name  || 'Cliente',
      email:    customer.email || 'cliente@arenaflow.app',
      document: rawDoc,
      type:     'individual',
      phones: { mobile_phone: mobilePhone },
    },
    card: {
      number:          card.number.replace(/\D/g, ''),
      holder_name:     card.holder_name.toUpperCase(),
      exp_month:       parseInt(card.exp_month, 10),
      exp_year:        parseInt(card.exp_year,  10),
      cvv:             card.cvv,
      billing_address: billing,
    },
  };

  return request('POST', '/subscriptions', payload);
}

/**
 * Cancela uma assinatura no Pagar.me.
 */
async function cancelSubscription(subscriptionId) {
  return request('DELETE', `/subscriptions/${subscriptionId}`);
}

/**
 * Consulta uma assinatura no Pagar.me.
 */
async function getSubscription(subscriptionId) {
  return request('GET', `/subscriptions/${subscriptionId}`);
}

module.exports = {
  createRecipient, getRecipient, updateRecipientTransferSettings,
  createOrder, createPlayerPixOrder,
  getCharge, cancelCharge,
  createPlan, getPlan,
  createSubscription, cancelSubscription, getSubscription,
};
