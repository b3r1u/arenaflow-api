const https    = require('https');
const FormData = require('form-data');

function getBaseUrl() {
  const env = process.env.ASAAS_ENVIRONMENT || 'sandbox';
  return env === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
}

function getConfig() {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada');
  return { apiKey, baseUrl: getBaseUrl() };
}

// Requisição JSON genérica
function request(method, path, body, overrideApiKey) {
  return new Promise((resolve, reject) => {
    const { apiKey, baseUrl } = getConfig();
    const url  = new URL(baseUrl + path);
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'access_token': overrideApiKey || apiKey,
        'Content-Type': 'application/json',
        'User-Agent':   'ArenaFlow/1.0',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const preview = raw.slice(0, 400) || '(vazio)';
        console.log(`[ASAAS] ${method} ${path} → ${res.statusCode} | ${preview}`);
        if (!raw.trim()) {
          if (res.statusCode >= 400) return reject(new Error(`[${res.statusCode}] resposta vazia`));
          return resolve({});
        }
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = json?.errors?.[0]?.description || json?.message || `ASAAS error ${res.statusCode}`;
            return reject(new Error(msg));
          }
          resolve(json);
        } catch {
          reject(new Error(`[${res.statusCode}] JSON inválido: ${raw.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Requisição multipart (upload de arquivo)
function requestMultipart(path, formData, overrideApiKey) {
  return new Promise((resolve, reject) => {
    const { apiKey, baseUrl } = getConfig();
    const url     = new URL(baseUrl + path);
    const headers = formData.getHeaders();

    const options = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        ...headers,
        'access_token': overrideApiKey || apiKey,
        'User-Agent':   'ArenaFlow/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        console.log(`[ASAAS] POST ${path} (multipart) → ${res.statusCode} | body: ${raw.slice(0, 300) || '(vazio)'}`);
        if (!raw.trim()) {
          if (res.statusCode >= 400) return reject(new Error(`ASAAS error ${res.statusCode}`));
          return resolve({});
        }
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = json?.errors?.[0]?.description || json?.message || `ASAAS error ${res.statusCode}`;
            return reject(new Error(msg));
          }
          resolve(json);
        } catch {
          reject(new Error(`ASAAS resposta inválida (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    formData.pipe(req);
  });
}

/**
 * Cria uma subconta ASAAS para o dono da arena.
 * Retorna { walletId, apiKey } — a apiKey só é retornada neste momento.
 */
async function createSubAccount({
  name, email, cpfCnpj, birthDate,
  mobilePhone, phone,
  companyType, incomeValue,
  address, addressNumber, complement, province, postalCode,
}) {
  const payload = {
    name,
    email,
    cpfCnpj:     cpfCnpj.replace(/\D/g, ''),
    incomeValue: incomeValue || 3000,
    whiteLabel:  true,
    ...(birthDate    ? { birthDate }    : {}),
    ...(companyType  ? { companyType }  : {}),
    ...(mobilePhone  ? { mobilePhone: mobilePhone.replace(/\D/g, '') } : {}),
    ...(phone        ? { phone: phone.replace(/\D/g, '') }             : {}),
    ...(address      ? { address }      : {}),
    ...(addressNumber? { addressNumber } : {}),
    ...(complement   ? { complement }   : {}),
    ...(province     ? { province }     : {}),
    ...(postalCode   ? { postalCode: postalCode.replace(/\D/g, '') } : {}),
  };

  const result = await request('POST', '/accounts', payload);
  return {
    walletId: result.walletId || result.id,
    apiKey:   result.apiKey,
  };
}

/**
 * Cadastra conta bancária na subconta ASAAS.
 * Se já existir (POST retorna 404 ou GET traz dados), trata como sucesso.
 */
async function createBankAccount(subApiKey, {
  bankCode, accountType, ownerName, cpfCnpj,
  agency, agencyDigit, account, accountDigit,
}) {
  // Verifica se já existe conta bancária cadastrada
  try {
    const existing = await request('GET', '/bankAccount', null, subApiKey);
    if (existing && (existing.id || (existing.data && existing.data.length > 0))) {
      console.log('[ASAAS] Conta bancária já cadastrada, pulando criação.');
      return existing;
    }
  } catch (e) {
    // GET falhou, tenta criar normalmente
  }

  const payload = {
    bank:            { code: bankCode },
    accountName:     'Conta principal',
    ownerName,
    cpfCnpj:         cpfCnpj.replace(/\D/g, ''),
    agency,
    agencyDigit:     agencyDigit || '',
    account,
    accountDigit,
    bankAccountType: accountType,
  };

  try {
    return await request('POST', '/bankAccount', payload, subApiKey);
  } catch (err) {
    // 404 no POST = conta já existe mas GET não retornou — trata como sucesso
    if (err.message.startsWith('[404]')) {
      console.log('[ASAAS] POST /bankAccount retornou 404 — conta provavelmente já registrada.');
      return {};
    }
    throw err;
  }
}

/**
 * Busca os grupos de documentos pendentes da subconta.
 * Retorna array com id, type, title, status, onboardingUrl (quando presente).
 * Conforme docs ASAAS: GET /v3/myAccount/documents
 */
async function getDocumentGroups(subApiKey) {
  const result = await request('GET', '/myAccount/documents', null, subApiKey);
  return result.data || [];
}

/**
 * Faz upload de documento via API (apenas para grupos SEM onboardingUrl).
 * Endpoint: POST /v3/myAccount/documents/{id}
 */
async function uploadDocumentById(subApiKey, groupId, { fileBuffer, filename, mimeType, type }) {
  const form = new FormData();
  form.append('type', type);
  form.append('documentFile', fileBuffer, { filename, contentType: mimeType });

  return requestMultipart(`/myAccount/documents/${groupId}`, form, subApiKey);
}

module.exports = { createSubAccount, createBankAccount, getDocumentGroups, uploadDocumentById };
