const prisma                                         = require('../lib/prisma');
const { encrypt, decrypt, maskDocument, maskPixKey } = require('../lib/crypto');
const { createSubAccount, createBankAccount, getDocumentGroups, uploadDocumentById } = require('../lib/asaas.service');

function toPublic(f) {
  return {
    id:               f.id,
    account_holder:   f.account_holder,
    document_type:    f.document_type,
    document_masked:  maskDocument(decrypt(f.document_encrypted)),
    pix_key_type:     f.pix_key_type,
    pix_key_masked:   maskPixKey(decrypt(f.pix_key_encrypted), f.pix_key_type),
    asaas_account_id: f.asaas_account_id,
    bank_registered:  !!f.bank_registered_at,
    docs_uploaded:    f.docs_uploaded_count || 0,
    status:           f.status,
    lgpd_consent_at:  f.lgpd_consent_at,
    created_at:       f.created_at,
    updated_at:       f.updated_at,
  };
}

function getSubApiKey(financial) {
  if (!financial.asaas_api_key_encrypted) return null;
  return decrypt(financial.asaas_api_key_encrypted);
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
    const {
      account_holder, document_type, document_value,
      pix_key_type, pix_key_value, lgpd_consent,
      email, phone, birth_date, company_type,
      address, address_number, complement, province, postal_code,
    } = req.body;

    if (!lgpd_consent) return res.status(400).json({ error: 'Consentimento LGPD é obrigatório' });
    if (!account_holder || !document_type || !document_value || !pix_key_type || !pix_key_value)
      return res.status(400).json({ error: 'Todos os campos financeiros são obrigatórios' });
    if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

    const est = await prisma.establishment.findUnique({ where: { owner_id: req.user.id } });
    if (!est) return res.status(404).json({ error: 'Estabelecimento não encontrado' });

    const rawDoc = document_value.replace(/\D/g, '');

    const payload = {
      account_holder, document_type,
      document_encrypted: encrypt(rawDoc),
      pix_key_type,
      pix_key_encrypted:  encrypt(pix_key_value),
      status:             'PENDING_REVIEW',
      lgpd_consent_at:    new Date(),
    };

    let financial = await prisma.financialInfo.upsert({
      where:  { establishment_id: est.id },
      update: payload,
      create: { establishment_id: est.id, ...payload },
    });

    let asaas_warning = null;
    if (!financial.asaas_account_id) {
      try {
        const { walletId, apiKey } = await createSubAccount({
          name: account_holder, email, cpfCnpj: rawDoc,
          birthDate: birth_date, mobilePhone: phone,
          companyType: company_type || (document_type === 'CNPJ' ? 'MEI' : undefined),
          address, addressNumber: address_number, complement, province, postalCode: postal_code,
        });
        financial = await prisma.financialInfo.update({
          where: { id: financial.id },
          data:  { asaas_account_id: walletId, ...(apiKey ? { asaas_api_key_encrypted: encrypt(apiKey) } : {}) },
        });
      } catch (asaasErr) {
        console.error('[ASAAS] Falha ao criar subconta:', asaasErr.message);
        asaas_warning = asaasErr.message;
      }
    }

    res.json({ financial: toPublic(financial), asaas_warning });
  } catch (err) { next(err); }
}

// POST /api/financial/bank-account
async function saveBankAccount(req, res, next) {
  try {
    const { bank_code, account_type, agency, agency_digit, account, account_digit } = req.body;

    if (!bank_code || !account_type || !agency || !account || !account_digit)
      return res.status(400).json({ error: 'Todos os campos bancários são obrigatórios' });

    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est?.financial)              return res.status(404).json({ error: 'Dados financeiros não encontrados' });
    if (!est.financial.asaas_account_id) return res.status(400).json({ error: 'Subconta ASAAS ainda não criada' });

    const subApiKey = getSubApiKey(est.financial);
    if (!subApiKey) return res.status(400).json({ error: 'Chave da subconta não disponível' });

    const rawDoc = decrypt(est.financial.document_encrypted);

    await createBankAccount(subApiKey, {
      bankCode:     bank_code,
      accountType:  account_type,
      ownerName:    est.financial.account_holder,
      cpfCnpj:      rawDoc,
      agency,
      agencyDigit:  agency_digit || '',
      account,
      accountDigit: account_digit,
    });

    const updated = await prisma.financialInfo.update({
      where: { id: est.financial.id },
      data:  { bank_registered_at: new Date() },
    });

    res.json({ financial: toPublic(updated) });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
}

// GET /api/financial/document-links
// Retorna os grupos de documentos pendentes com onboardingUrl (White Label)
async function getDocumentLinks(req, res, next) {
  try {
    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est?.financial)              return res.status(404).json({ error: 'Dados financeiros não encontrados' });
    if (!est.financial.asaas_account_id) return res.status(400).json({ error: 'Subconta ASAAS ainda não criada' });

    const subApiKey = getSubApiKey(est.financial);
    if (!subApiKey) return res.status(400).json({ error: 'Chave da subconta não disponível' });

    const groups = await getDocumentGroups(subApiKey);

    // Filtra apenas pendentes/rejeitados e normaliza os campos relevantes
    const links = groups
      .filter(g => g.status !== 'APPROVED')
      .map(g => ({
        id:            g.id,
        type:          g.type,
        title:         g.title,
        description:   g.description || null,
        status:        g.status,
        onboardingUrl: g.onboardingUrl || null,
      }));

    res.json({ links });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
}

// POST /api/financial/document/:groupId  (multipart — apenas para grupos sem onboardingUrl)
async function saveDocument(req, res, next) {
  try {
    const { groupId } = req.params;
    const file = req.file;

    if (!groupId || !file) return res.status(400).json({ error: 'ID do grupo e arquivo são obrigatórios' });

    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est?.financial)              return res.status(404).json({ error: 'Dados financeiros não encontrados' });
    if (!est.financial.asaas_account_id) return res.status(400).json({ error: 'Subconta ASAAS ainda não criada' });

    const subApiKey = getSubApiKey(est.financial);
    if (!subApiKey) return res.status(400).json({ error: 'Chave da subconta não disponível' });

    const { doc_type } = req.body;

    await uploadDocumentById(subApiKey, groupId, {
      fileBuffer: file.buffer,
      filename:   file.originalname,
      mimeType:   file.mimetype,
      type:       doc_type,
    });

    const updated = await prisma.financialInfo.update({
      where: { id: est.financial.id },
      data:  { docs_uploaded_count: { increment: 1 } },
    });

    res.json({ financial: toPublic(updated) });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
}

module.exports = { getFinancial, saveFinancial, saveBankAccount, getDocumentLinks, saveDocument };
