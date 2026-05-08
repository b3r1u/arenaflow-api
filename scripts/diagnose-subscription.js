/**
 * Diagnóstico de assinatura/cobrança falha no Pagar.me
 * Uso: node scripts/diagnose-subscription.js [subscription_id]
 * Ex:  node scripts/diagnose-subscription.js sub_l4nKnXzTVluJBrdX
 */
require('dotenv').config();

const https = require('https');

function getAuthHeader() {
  const apiKey = process.env.PAGARME_API_KEY;
  if (!apiKey) throw new Error('PAGARME_API_KEY não configurada');
  return 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
}

function request(method, path) {
  return new Promise((resolve, reject) => {
    const url  = new URL('https://api.pagar.me/core/v5' + path);
    const opts = {
      hostname: url.hostname,
      port:     443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type':  'application/json',
        'User-Agent':    'ArenaFlow/1.0',
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sep(label) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + label);
  console.log('═'.repeat(60));
}

async function diagnose(subId) {
  // 1. Busca a assinatura
  sep(`ASSINATURA: ${subId}`);
  const { status: subStatus, body: sub } = await request('GET', `/subscriptions/${subId}`);
  console.log(`HTTP: ${subStatus}`);
  if (subStatus >= 400) {
    console.error('Erro:', JSON.stringify(sub, null, 2));
    return;
  }

  console.log(`Status         : ${sub.status}`);
  console.log(`Plano          : ${sub.plan?.name} (${sub.plan?.id})`);
  console.log(`Criado em      : ${sub.created_at}`);
  console.log(`Próx. cobrança : ${sub.next_billing_at || 'N/A'}`);
  console.log(`Cartão         : ${sub.card ? `${sub.card.brand} ****${sub.card.last_four_digits}` : 'N/A'}`);
  console.log(`Cliente        : ${sub.customer?.name} | ${sub.customer?.email}`);

  // Ciclo atual
  if (sub.current_cycle) {
    const cycle = sub.current_cycle;
    sep('CICLO ATUAL');
    console.log(`Ciclo ID       : ${cycle.id}`);
    console.log(`Status ciclo   : ${cycle.status}`);
    console.log(`Início         : ${cycle.start_at}`);
    console.log(`Fim            : ${cycle.end_at}`);
    console.log(`Billing at     : ${cycle.billing_at}`);

    if (cycle.last_charge) {
      const ch = cycle.last_charge;
      sep('ÚLTIMA COBRANÇA (last_charge)');
      console.log(`Charge ID      : ${ch.id}`);
      console.log(`Status         : ${ch.status}`);
      console.log(`Valor          : R$${(ch.amount / 100).toFixed(2)}`);
      console.log(`Criada em      : ${ch.created_at}`);
      console.log(`Atualizada em  : ${ch.updated_at}`);
    }
  }

  // 2. Busca charges da assinatura
  sep('CHARGES DA ASSINATURA');
  const { status: chStatus, body: chResp } = await request('GET', `/charges?subscription_id=${subId}&size=10`);
  console.log(`HTTP: ${chStatus}`);

  const charges = chResp?.data || [];
  if (!charges.length) {
    console.log('Nenhuma charge encontrada para esta assinatura.');
  }

  for (const ch of charges) {
    console.log('\n' + '-'.repeat(50));
    console.log(`Charge ID      : ${ch.id}`);
    console.log(`Status         : ${ch.status}`);
    console.log(`Valor          : R$${(ch.amount / 100).toFixed(2)}`);
    console.log(`Método         : ${ch.payment_method}`);
    console.log(`Criada em      : ${ch.created_at}`);
    console.log(`Atualizada em  : ${ch.updated_at}`);

    if (ch.last_transaction) {
      const tx = ch.last_transaction;
      console.log('\n  >> ÚLTIMA TRANSAÇÃO:');
      console.log(`  ID             : ${tx.id}`);
      console.log(`  Status         : ${tx.status}`);
      console.log(`  Bandeira       : ${tx.card_brand || 'N/A'}`);
      console.log(`  Acquirer       : ${tx.acquirer_name || 'N/A'} | ${tx.acquirer_id || ''}`);
      console.log(`  Código resposta: ${tx.acquirer_return_code || 'N/A'}`);
      console.log(`  Mensagem       : ${tx.acquirer_message || 'N/A'}`);
      console.log(`  NSU            : ${tx.nsu || 'N/A'}`);
      console.log(`  TID            : ${tx.tid || 'N/A'}`);
      console.log(`  Auth code      : ${tx.authorization_code || 'N/A'}`);
      console.log(`  Gatilho erro   : ${tx.gateway_response?.errors?.map(e => e.message).join(', ') || 'nenhum'}`);
      if (tx.gateway_response) {
        console.log(`  Gateway resp   : ${JSON.stringify(tx.gateway_response)}`);
      }
      if (tx.three_d_authentication_url) {
        console.log(`  3DS URL        : ${tx.three_d_authentication_url}`);
      }
    }

    // Busca detalhes completos da charge
    console.log('\n  >> Buscando detalhes completos...');
    const { status: cds, body: cd } = await request('GET', `/charges/${ch.id}`);
    if (cds === 200 && cd?.last_transaction) {
      const tx2 = cd.last_transaction;
      if (tx2.acquirer_return_code || tx2.acquirer_message) {
        console.log(`  Acquirer retorno: ${tx2.acquirer_return_code} — ${tx2.acquirer_message}`);
      }
      if (tx2.metadata) console.log(`  Metadata:       `, JSON.stringify(tx2.metadata));
    }
  }

  // 3. Verifica o plano no Pagar.me
  if (sub.plan?.id) {
    sep(`PLANO NO PAGAR.ME: ${sub.plan.id}`);
    const { status: ps, body: plan } = await request('GET', `/plans/${sub.plan.id}`);
    console.log(`HTTP: ${ps}`);
    if (ps === 200) {
      const item = plan.items?.[0];
      const price = item?.pricing_scheme?.price;
      console.log(`Nome           : ${plan.name}`);
      console.log(`Status         : ${plan.status}`);
      console.log(`Intervalo      : ${plan.interval} (${plan.interval_count}x)`);
      console.log(`Valor item     : R$${price != null ? (price / 100).toFixed(2) : 'N/A'}`);
      console.log(`Métodos        : ${(plan.payment_methods || []).join(', ')}`);
      console.log(`Billing type   : ${plan.billing_type}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  FIM DO DIAGNÓSTICO');
  console.log('═'.repeat(60) + '\n');
}

const subId = process.argv[2] || 'sub_l4nKnXzTVluJBrdX';
diagnose(subId).catch(console.error);
