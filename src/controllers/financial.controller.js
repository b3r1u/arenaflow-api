const prisma                                         = require('../lib/prisma');
const { encrypt, decrypt, maskDocument, maskPixKey } = require('../lib/crypto');
const { createRecipient, getRecipient }              = require('../lib/pagarme.service');

function toPublic(f) {
  return {
    id:                    f.id,
    account_holder:        f.account_holder,
    document_type:         f.document_type,
    document_masked:       maskDocument(decrypt(f.document_encrypted)),
    pix_key_type:          f.pix_key_type,
    pix_key_masked:        maskPixKey(decrypt(f.pix_key_encrypted), f.pix_key_type),
    pagarme_recipient_id:  f.pagarme_recipient_id,
    bank_registered:       !!f.bank_registered_at,
    lgpd_consent_at:       f.lgpd_consent_at,
    created_at:            f.created_at,
    updated_at:            f.updated_at,
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

    const pub = toPublic(est.financial);

    // Busca status real do Pagar.me se recebedor já foi criado
    if (est.financial.pagarme_recipient_id) {
      try {
        const recipient = await getRecipient(est.financial.pagarme_recipient_id);
        pub.pagarme_status = recipient.status; // ex: 'active', 'registration', etc.
      } catch { /* ignora falhas na consulta ao Pagar.me */ }
    }

    res.json({ financial: pub });
  } catch (err) { next(err); }
}

// POST /api/financial/me — salva dados pessoais (sem chamada externa)
async function saveFinancial(req, res, next) {
  try {
    const {
      account_holder, document_type, document_value,
      pix_key_type, pix_key_value, lgpd_consent,
      email, phone, birth_date, company_type,
      mother_name, monthly_income, professional_occupation,
      address, address_number, complement, province, postal_code,
      city, state,
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
      email:          email        || null,
      phone:          phone        || null,
      birth_date:     birth_date   || null,
      company_type:   company_type || null,
      mother_name:             mother_name             || null,
      monthly_income:          monthly_income != null ? String(monthly_income) : null,
      professional_occupation: professional_occupation || null,
      address:        address      || null,
      address_number: address_number || null,
      complement:     complement   || null,
      province:       province     || null,
      postal_code:    postal_code  || null,
      city:           city         || null,
      state:          state        || null,
    };

    const financial = await prisma.financialInfo.upsert({
      where:  { establishment_id: est.id },
      update: payload,
      create: { establishment_id: est.id, ...payload },
    });

    res.json({ financial: toPublic(financial) });
  } catch (err) { next(err); }
}

// POST /api/financial/bank-account — salva dados bancários e cria recebedor no Pagar.me
async function saveBankAccount(req, res, next) {
  try {
    const { bank_code, account_type, agency, agency_digit, account, account_digit } = req.body;

    if (!bank_code || !account_type || !agency || !account || !account_digit)
      return res.status(400).json({ error: 'Todos os campos bancários são obrigatórios' });

    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est?.financial) return res.status(404).json({ error: 'Dados financeiros não encontrados' });

    const f      = est.financial;
    const rawDoc = decrypt(f.document_encrypted);

    // Cria ou atualiza recebedor no Pagar.me
    let recipientId = f.pagarme_recipient_id;
    if (!recipientId) {
      recipientId = await createRecipient({
        name:           f.account_holder,
        email:          f.email,
        document:       rawDoc,
        birthdate:      f.birth_date  || undefined,
        companyType:    f.company_type || undefined,
        motherName:             f.mother_name             || undefined,
        monthlyIncome:          f.monthly_income          || undefined,
        professionalOccupation: f.professional_occupation || undefined,
        phone:          f.phone        || undefined,
        address:        f.address      || undefined,
        addressNumber:  f.address_number || undefined,
        complement:     f.complement   || undefined,
        neighborhood:   f.province     || undefined,
        city:           f.city         || undefined,
        state:          f.state        || undefined,
        postalCode:     f.postal_code  || undefined,
        bankCode:       bank_code,
        bankAccountType: account_type,
        bankAgency:     agency,
        bankAgencyDigit: agency_digit || '',
        bankAccount:    account,
        bankAccountDigit: account_digit,
      });
    }

    const updated = await prisma.financialInfo.update({
      where: { id: f.id },
      data:  {
        pagarme_recipient_id: recipientId,
        bank_registered_at:   new Date(),
        bank_code,
        bank_account_type:    account_type,
        bank_agency:          agency,
        bank_agency_digit:    agency_digit || null,
        bank_account:         account,
        bank_account_digit:   account_digit,
      },
    });

    res.json({ financial: toPublic(updated) });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
}

// GET /api/financial/recipient-status — consulta status do recebedor no Pagar.me
async function getRecipientStatus(req, res, next) {
  try {
    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est?.financial)                    return res.status(404).json({ error: 'Dados financeiros não encontrados' });
    if (!est.financial.pagarme_recipient_id) return res.status(400).json({ error: 'Recebedor ainda não cadastrado no Pagar.me' });

    const recipient = await getRecipient(est.financial.pagarme_recipient_id);
    res.json({
      id:     recipient.id,
      status: recipient.status,
      name:   recipient.name,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    next(err);
  }
}

// GET /api/financial/me/form — retorna dados decriptados para pré-preencher o formulário
async function getFinancialForm(req, res, next) {
  try {
    const est = await prisma.establishment.findUnique({
      where:   { owner_id: req.user.id },
      include: { financial: true },
    });
    if (!est)           return res.status(404).json({ error: 'Estabelecimento não encontrado' });
    if (!est.financial) return res.json({ form: null });

    const f = est.financial;
    res.json({
      form: {
        account_holder: f.account_holder,
        document_type:  f.document_type,
        document_value: decrypt(f.document_encrypted),
        pix_key_type:   f.pix_key_type,
        pix_key_value:  decrypt(f.pix_key_encrypted),
        email:          f.email        || '',
        phone:          f.phone        || '',
        birth_date:     f.birth_date   || '',
        company_type:   f.company_type || 'MEI',
        mother_name:             f.mother_name             || '',
        monthly_income:          f.monthly_income          || '',
        professional_occupation: f.professional_occupation || '',
        address:        f.address      || '',
        address_number: f.address_number || '',
        complement:     f.complement   || '',
        province:       f.province     || '',
        postal_code:    f.postal_code  || '',
        city:           f.city         || '',
        state:          f.state        || '',
        bank_code:          f.bank_code          || '',
        bank_account_type:  f.bank_account_type  || 'CONTA_CORRENTE',
        bank_agency:        f.bank_agency        || '',
        bank_agency_digit:  f.bank_agency_digit  || '',
        bank_account:       f.bank_account       || '',
        bank_account_digit: f.bank_account_digit || '',
      }
    });
  } catch (err) { next(err); }
}

module.exports = { getFinancial, saveFinancial, saveBankAccount, getRecipientStatus, getFinancialForm };
