require('dotenv').config();
const { Pool }         = require('pg');
const { PrismaPg }     = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Iniciando seed dos planos...');

  const plans = [
    {
      slug:       'free',
      name:       'Free',
      price:      0,
      max_courts: 1,
      features:   ['1 quadra', 'Agendamentos básicos', 'Suporte por e-mail'],
    },
    {
      slug:       'essencial',
      name:       'Essencial',
      price:      89,
      max_courts: 2,
      features:   ['2 quadras', 'Relatórios básicos', 'Suporte prioritário'],
    },
    {
      slug:       'pro',
      name:       'Pro',
      price:      159,
      max_courts: 5,
      features:   ['5 quadras', 'Relatórios avançados', 'Mensalistas', 'Suporte prioritário', '+R$39/quadra extra'],
    },
    {
      slug:       'business',
      name:       'Business',
      price:      269,
      max_courts: null,
      features:   ['Quadras ilimitadas', 'Relatórios avançados', 'Mensalistas', 'Suporte dedicado', '+R$39/quadra extra'],
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where:  { slug: plan.slug },
      update: plan,
      create: plan,
    });
    console.log(`  ✅ Plano "${plan.name}" salvo`);
  }

  console.log('\n✨ Seed concluído!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
