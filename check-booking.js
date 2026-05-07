require('dotenv').config();
const prisma = require('./src/lib/prisma');

async function main() {
  const booking = await prisma.booking.findUnique({
    where: { id: '9efcd04a-e3ba-41be-81e6-d4c7e03f84d6' },
    include: { payment_group: { include: { splits: true } } },
  });

  console.log('=== BOOKING ===');
  console.log(JSON.stringify({
    id:               booking.id,
    client_name:      booking.client_name,
    payment_status:   booking.payment_status,
    payment_option:   booking.payment_option,
    paid_amount:      Number(booking.paid_amount),
    total_amount:     Number(booking.total_amount),
    pagarme_charge_id: booking.pagarme_charge_id,
    pagarme_order_id:  booking.pagarme_order_id,
    updated_at:       booking.updated_at,
    payment_group:    booking.payment_group,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
