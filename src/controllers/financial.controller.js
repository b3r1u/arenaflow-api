const prisma                          = require('../lib/prisma');
const { encrypt, decrypt, maskDocument, maskPixKey } = require('../lib/crypto');

function sanitize(raw) {
  const { document_encrypted, pix_key_encrypted, ...safe } = raw;
  return safe;
}

function toPublic(f) {
  return {
    id:               f.id,
    account_holder:   f.account_holder,
    document_type:    f.document_type,
    document_masked:  maskDocument(decrypt(f.document_encrypted)),
    pix_key_type:     f.pix_key_type,
    pix_key_masked:   maskPixKey(decrypt(f.pix_key_encrypted), f.pix_key_type),
    asaas_account_id: f.asaas_account_id,
    status:           f.status,
    lgpd_consent_at:  f.lgpd_consent_at,
    created_at:       f.created_at,
    updated_at:       f.updated_at,
  };
}

// GET /api/financial/me
async function getFinancial(req, res, next) {
  try {
    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });

    if (!est)             return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    if (!est.financial)   return res.json({ financial: null });

    res.json({ financial: toPublic(est.financial) });
  } catch (err) { next(err); }
}

// POST /api/financial/me
async function saveFinancial(req, res, next) {
  try {
    const { account_holder, document_type, document_value,
            pix_key_type, pix_key_value, lgpd_consent } = req.body;

    if (!lgpd_consent) {
      return res.status(400).json({ error: 'Consentimento LGPD é obrigatório' });
    }
    if (!account_holder || !document_type || !document_value || !pix_key_type || !pix_key_value) {
      return res.status(400).json({ error: 'Todos os campos financeiros são obrigatórios' });
    }

    const est = await prisma.establishment.findUnique({ where: { owner_id: req.user.id } });
    if (!est) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const payload = {
      account_holder,
      document_type,
      document_encrypted: encrypt(document_value.replace(/\D/g, '')),
      pix_key_type,
      pix_key_encrypted:  encrypt(pix_key_value),
      status:             'PENDING_REVIEW',
      lgpd_consent_at:    new Date(),
    };

    const financial = await prisma.financialInfo.upsert({
      where:  { establishment_id: est.id },
      update: payload,
      create: { establishment_id: est.id, ...payload },
    });

    res.json({ financial: toPublic(financial) });
  } catch (err) { next(err); }
}

module.exports = { getFinancial, saveFinancial };
