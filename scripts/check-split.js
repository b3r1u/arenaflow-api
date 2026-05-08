/**
 * Verifica o split das últimas orders PIX no Pagar.me
 * Uso: node scripts/check-split.js
 */
require('dotenv').config();
const https = require('https');

function req(path) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.PAGARME_API_KEY;
    const opts = {
      hostname: 'api.pagar.me', port: 443, path: '/core/v5' + path, method: 'GET',
      headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') }
    };
    const r = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    r.on('error', reject);
    r.end();
  });
}

async function main() {
  const resp   = await req('/orders?size=10');
  const orders = resp.data || [];

  if (!orders.length) { console.log('Nenhuma order encontrada.'); return; }

  for (const o of orders) {
    const charge  = o.charges?.[0];
    const payment = o.charges?.[0]?.last_transaction;

    // Split pode estar no payment.split_rules ou no charge-level
    const splits = charge?.split_rules
      || payment?.split_rules
      || o.split_rules
      || [];

    console.log('─'.repeat(55));
    console.log(`Order  : ${o.id}`);
    console.log(`Status : ${o.status}  |  R$${(o.amount / 100).toFixed(2)}`);
    console.log(`Método : ${charge?.payment_method || 'N/A'}`);
    console.log(`Data   : ${o.created_at?.slice(0, 10)}`);

    if (splits.length > 0) {
      console.log('Split  :');
      splits.forEach(s => {
        const tipo = s.amount != null ? `${s.amount}%` : `R$${(s.flat_amount / 100).toFixed(2)}`;
        console.log(`  → ${s.recipient_id}  ${tipo}  liable:${s.options?.liable}`);
      });
    } else {
      // Tenta pegar detalhes completos da order
      const full = await req(`/orders/${o.id}`);
      const fullCharge  = full.charges?.[0];
      const fullPayment = full.charges?.[0]?.last_transaction;
      const fullSplits  = fullCharge?.split_rules || fullPayment?.split_rules || full.split_rules || [];

      if (fullSplits.length > 0) {
        console.log('Split  :');
        fullSplits.forEach(s => {
          const tipo = s.amount != null ? `${s.amount}%` : `R$${(s.flat_amount / 100).toFixed(2)}`;
          console.log(`  → ${s.recipient_id}  ${tipo}  liable:${s.options?.liable}`);
        });
      } else {
        console.log('Split  : ⚠️  sem split (order antiga ou arena sem recipient)');
      }
    }
  }
  console.log('─'.repeat(55));
}

main().catch(console.error);
