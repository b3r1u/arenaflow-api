const https = require('https');

function getBaseUrl() {
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
        const preview = raw.slice(0, 400) || '(vazio)';
        console.log(`[PAGARME] ${method} ${path} → ${res.statusCode} | ${preview}`);
        if (!raw.trim()) {
          if (res.statusCode >= 400) return reject(new Error(`Pagar.me error ${res.statusCode}`));
          return resolve({});
        }
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = json?.message || json?.errors?.[0]?.message || `Pagar.me error ${res.statusCode}`;
            return reject(new Error(msg));
          }
          resolve(json);
        } catch {
          reject(new Error(`Pagar.me resposta inválida (${res.statusCode}): ${raw.slice(0, 300)}`));
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

/**
 * Cria um recebedor no Pagar.me com dados pessoais e conta bancária.
 * Retorna o recipient_id (ex: rp_XXXXXXXXXXXXXXXX).
 */
async function createRecipient({
  name, email, document,
  birthdate, companyType,
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

  const registerInformation = isIndividual
    ? {
        type:     'individual',
        email,
        document: rawDoc,
      }
    : {
        type:             'corporation',
        email,
        document:         rawDoc,
        company_name:     name,
        trading_name:     name,
        annual_revenue:   1200000, // R$ 12.000 padrão
        corporation_type: corporationTypeMap[companyType] || 'LTDA',
      };

  const payload = {
    code: `arenaflow_${rawDoc}`,
    name,
    email,
    document: rawDoc,
    type:     recipientType,
    default_bank_account: {
      holder_name:         name,
      holder_type:         isIndividual ? 'individual' : 'company',
      holder_document:     rawDoc,
      bank:                bankCode,
      branch_number:       bankAgency,
      branch_check_digit:  bankAgencyDigit || '',
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

module.exports = { createRecipient, getRecipient };
