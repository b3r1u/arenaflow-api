require('dotenv').config();
const prisma = require('./src/lib/prisma');
async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'roberioalbuquerque.neto@gmail.com' },
    include: { subscription: { include: { plan: true } }, establishment: true }
  });
  if (!user) { console.log('Usuário não encontrado'); return; }
  console.log('Role:', user.role);
  console.log('Sub status:', user.subscription?.status);
  console.log('Plan slug:', user.subscription?.plan?.slug);
  console.log('Trial ends_at:', user.subscription?.trial_ends_at);
  const now = new Date();
  const ends = user.subscription?.trial_ends_at ? new Date(user.subscription.trial_ends_at) : null;
  if (ends) {
    const diffMs = ends - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    console.log('Dias restantes:', diffDays);
    console.log('Trial expirado?', ends < now ? 'SIM' : 'NÃO');
  }
  console.log('Establishment:', user.establishment?.name ?? 'nenhum');
}
main().catch(console.error).finally(() => process.exit());
