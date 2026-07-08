// Idempotent v2 bootstrap: make sure the permanent "Civic North Internal"
// client exists and is flagged internal. Safe to run on every boot.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const flagged = await prisma.client.findFirst({ where: { isInternal: true } });
  if (flagged) return;
  const existing = await prisma.client.findFirst({ where: { name: 'Civic North Internal' } });
  if (existing) {
    await prisma.client.update({ where: { id: existing.id }, data: { isInternal: true } });
    console.log('Flagged existing Civic North Internal client as internal.');
  } else {
    await prisma.client.create({
      data: {
        name: 'Civic North Internal',
        emails: [],
        keywords: ['internal'],
        notes: 'Permanent home for internal (non-client) projects and tasks.',
        isInternal: true,
      },
    });
    console.log('Created Civic North Internal client.');
  }
}

main()
  .catch((e) => {
    // Never block app start on the bootstrap
    console.error('ensure-internal failed:', e.message);
  })
  .finally(() => prisma.$disconnect());
