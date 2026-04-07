const { Pool }       = require('pg');
const { PrismaPg }   = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

function createPrisma() {
  const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });
}

const prisma = global.__prisma || createPrisma();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

module.exports = prisma;
