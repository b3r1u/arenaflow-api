const prisma                          = require('../lib/prisma');
const { encrypt, decrypt, maskDocument, maskPixKey } = require('../lib/crypto');
const { createSubAccount }            = require('../lib/asaas.service');

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

    if (!est)           return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    if (!est.financial) return res.json({ financial: null });

    res.json({ financial: toPublic(est.financial) });
  } catch (err) { next(err); }
}

// POST /api/financial/me
async function saveFinancial(req, res, next) {
  try {
    const { account_holder, document_type, document_value,
            pix_key_type, pix_key_value, lgpd_consent,
            email, phone } = req.body;

    if (!lgpd_consent) {
      return res.status(400).json({ error: 'Consentimento LGPD é obrigatório' });
    }
    if (!account_holder || !document_type || !document_value || !pix_key_type || !pix_key_value) {
      return res.status(400).json({ error: 'Todos os campos financeiros são obrigatórios' });
    }
    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório para criação da subconta de pagamentos' });
    }

    const est = await prisma.establishment.findUnique({ where: { owner_id: req.user.id } });
    if (!est) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const rawDoc = document_value.replace(/\D/g, '');

    const payload = {
      account_holder,
      document_type,
      document_encrypted: encrypt(rawDoc),
      pix_key_type,
      pix_key_encrypted:  encrypt(pix_key_value),
      status:             'PENDING_REVIEW',
      lgpd_consent_at:    new Date(),
    };

    // Upsert — salva os dados antes de chamar ASAAS para não perder em caso de falha da API
    let financial = await prisma.financialInfo.upsert({
      where:  { establishment_id: est.id },
      update: payload,
      create: { establishment_id: est.id, ...payload },
    });

    // Cria subconta ASAAS apenas se ainda não tiver uma
    if (!financial.asaas_account_id) {
      try {
        const companyType = document_type === 'CNPJ' ? 'MEI' : undefined;
        const walletId = await createSubAccount({
          name:        account_holder,
          email:       email || req.user.email,
          cpfCnpj:     rawDoc,
          mobilePhone: phone,
          companyType,
        });

        financial = await prisma.financialInfo.update({
          where: { id: financial.id },
          data:  { asaas_account_id: walletId },
        });
      } catch (asaasErr) {
        // Não falha o cadastro — registra o erro e retorna com status PENDING_REVIEW
        console.error('[ASAAS] Falha ao criar subconta:', asaasErr.message);
      }
    }

    res.json({ financial: toPublic(financial) });
  } catch (err) { next(err); }
}

module.exports = { getFinancial, saveFinancial };
