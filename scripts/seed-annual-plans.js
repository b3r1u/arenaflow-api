/**
 * Cria os planos anuais no banco e sincroniza com o Pagar.me.
 * Executa com: node scripts/seed-annual-plans.js
 *
 * Para cada plano pago mensal (essencial, pro, business):
 *  - Cria versão anual no banco com slug = '<slug>-anual' e price = price * 0.8
 *    (equivalente mensal com 20% de desconto)
 *  - Sincroniza com Pagar.me como plano anual (interval: year, cobra price*12 por ano)
 */
require('dotenv').config();

const prisma  = require('../src/lib/prisma');
const pagarme = require('../src/lib/pagarme.service');

async function main() {
  // Busca planos mensais pagos
  const monthlyPlans = await prisma.plan.findMany({
    where: { price: { gt: 0 }, active: true },
    orderBy: { price: 'asc' },
  });

  const annualSlugs = monthlyPlans
    .filter(p => !p.slug.endsWith('-anual'))
    .map(p => p.slug);

  console.log(`Planos mensais encontrados: ${annualSlugs.join(', ')}`);

  for (const monthly of monthlyPlans.filter(p => !p.slug.endsWith('-anual'))) {
    const annualSlug  = `${monthly.slug}-anual`;
    const annualPrice = Math.round(monthly.price * 0.8 * 100) / 100; // mensal c/ 20% desc

    // Upsert no banco
    let annualPlan = await prisma.plan.findUnique({ where: { slug: annualSlug } });

    if (!annualPlan) {
      annualPlan = await prisma.plan.create({
        data: {
          slug:        annualSlug,
          name:        `${monthly.name} Anual`,
          description: `${monthly.description || monthly.name} — cobrado anualmente com 20% de desconto.`,
          price:       annualPrice,
          max_courts:  monthly.max_courts,
          features:    monthly.features,
          active:      true,
        },
      });
      console.log(`✅ Criado no banco: ${annualSlug} (R$${annualPrice}/mês equivalente)`);
    } else {
      // Atualiza preço caso o mensal tenha mudado
      await prisma.plan.update({
        where: { id: annualPlan.id },
        data:  { price: annualPrice },
      });
      console.log(`🔄 Atualizado no banco: ${annualSlug} → R$${annualPrice}/mês equivalente`);
    }

    // Sincroniza com Pagar.me (cria novo plano anual)
    if (!annualPlan.pagarme_plan_id) {
      try {
        const priceCents = Math.round(annualPrice * 12 * 100); // total anual em centavos
        const result = await pagarme.createPlan({
          name:          annualPlan.name,
          slug:          annualSlug,
          priceCents,
          interval:      'year',
          intervalCount: 1,
        });

        await prisma.plan.update({
          where: { slug: annualSlug },
          data:  { pagarme_plan_id: result.id },
        });

        console.log(`✅ Sincronizado com Pagar.me: ${annualSlug} → ${result.id} (R$${(priceCents/100).toFixed(2)}/ano)`);
      } catch (err) {
        console.error(`❌ Erro ao sincronizar ${annualSlug} com Pagar.me:`, err.message);
      }
    } else {
      console.log(`⏭️  ${annualSlug} já tem pagarme_plan_id: ${annualPlan.pagarme_plan_id}`);
    }
  }

  console.log('\nConcluído!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
