const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY inválida — deve ter 64 caracteres hex (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  const key  = getKey();
  const iv   = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

function decrypt(stored) {
  const key = getKey();
  const [ivHex, tagHex, enc] = stored.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function maskDocument(doc) {
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0,3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0,2)}.***.***/****-${d.slice(12)}`;
  return '***';
}

function maskPixKey(value, type) {
  if (type === 'EMAIL') {
    const [u, domain] = value.split('@');
    return `${u.slice(0,2)}***@${domain}`;
  }
  if (type === 'PHONE') return `***${value.slice(-4)}`;
  if (type === 'RANDOM') return `${value.slice(0,8)}...`;
  return maskDocument(value); // CPF / CNPJ
}

module.exports = { encrypt, decrypt, maskDocument, maskPixKey };
