require('dotenv').config();
const prisma  = require('../src/lib/prisma');
const pagarme = require('../src/lib/pagarme.service');

async function main() {
  const subs = await prisma.subscription.findMany({
    include: { user: true, plan: true },
    orderBy: { updated_at: 'desc' },
  });

  if (!subs.length) { console.log('Nenhuma assinatura.'); return; }

  for (const sub of subs) {
    console.log('─'.repeat(60));
    console.log(`Usuário    : ${sub.user.email}`);
    console.log(`Plano DB   : ${sub.plan.name} (${sub.plan.slug})`);
    console.log(`Status DB  : ${sub.status}`);
    console.log(`Sub ID     : ${sub.pagarme_subscription_id || 'nenhum'}`);
    console.log(`Criado     : ${sub.created_at}`);
    console.log(`Atualizado : ${sub.updated_at}`);

    if (sub.pagarme_subscription_id) {
      try {
        const r = await pagarme.getSubscription(sub.pagarme_subscription_id);
        console.log(`Pagar.me   : status=${r.status} | plano=${r.plan?.name} | próx=${r.next_billing_at || 'N/A'}`);
        const ch = r.current_cycle?.last_charge;
        if (ch) console.log(`Última charge: ${ch.id} | status=${ch.status} | R$${(ch.amount/100).toFixed(2)}`);
      } catch (e) {
        console.log(`Pagar.me   : ERRO — ${e.message}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
