const https = require('https');

function getConfig() {
  const apiKey = process.env.ASAAS_API_KEY;
  const env    = process.env.ASAAS_ENVIRONMENT || 'sandbox';

  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada');

  const baseUrl = env === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';

  return { apiKey, baseUrl };
}

function request(method, path, body) {
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
        'access_token': apiKey,
        'Content-Type': 'application/json',
        'User-Agent':   'ArenaFlow/1.0',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = json?.errors?.[0]?.description || json?.message || `ASAAS error ${res.statusCode}`;
            return reject(new Error(msg));
          }
          resolve(json);
        } catch {
          reject(new Error(`ASAAS resposta inválida: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Cria uma subconta ASAAS para o dono da arena.
 * Retorna { walletId, apiKey } — a apiKey só é retornada neste momento,
 * nunca pode ser recuperada depois, então deve ser armazenada criptografada.
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
    incomeValue: incomeValue || 3000,          // renda/faturamento mensal (obrigatório)
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
    apiKey:   result.apiKey,           // presente apenas na resposta de criação
  };
}

module.exports = { createSubAccount };
