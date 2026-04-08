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
 * Retorna o walletId que será armazenado em FinancialInfo.asaas_account_id.
 */
async function createSubAccount({ name, email, cpfCnpj, mobilePhone, companyType }) {
  const payload = {
    name,
    email,
    cpfCnpj: cpfCnpj.replace(/\D/g, ''),
    mobilePhone: mobilePhone ? mobilePhone.replace(/\D/g, '') : undefined,
    ...(companyType ? { companyType } : {}),
  };

  const result = await request('POST', '/accounts', payload);
  // ASAAS retorna walletId na subconta criada
  return result.walletId || result.id;
}

module.exports = { createSubAccount };
