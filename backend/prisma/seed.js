const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('changeme123', 10);

  // Sophie owns the admin panel; the seed re-asserts it on every run so a
  // reseeded dev DB never ends up with nobody able to manage users.
  await prisma.user.upsert({
    where: { email: 'sophie@civicnorthconsulting.com' },
    update: { role: 'ADMIN' },
    create: {
      name: 'Sophie Kather',
      email: 'sophie@civicnorthconsulting.com',
      passwordHash,
      role: 'ADMIN',
      weeklyHourTarget: 35,
    },
  });

  await prisma.user.upsert({
    where: { email: 'david@civicnorthconsulting.com' },
    update: {},
    create: {
      name: 'David Poulin',
      email: 'david@civicnorthconsulting.com',
      passwordHash,
      weeklyHourTarget: 35,
    },
  });

  await prisma.user.upsert({
    where: { email: 'april@civicnorthconsulting.com' },
    update: {},
    create: {
      name: 'April Luebbert',
      email: 'april@civicnorthconsulting.com',
      passwordHash,
      weeklyHourTarget: 35,
    },
  });

  const taskTypeNames = [
    'Grant Writing',
    'Grant Strategy',
    'Proposal Writing',
    'Contract Management',
    'Sales Operations',
    'Project Management',
    'Business Development',
    'Marketing',
    'Prospecting',
    'Fundraising',
    'Branding',
    'General Hours',
    'Vacation',
  ];

  for (const name of taskTypeNames) {
    await prisma.taskType.upsert({
      where: { name },
      update: {},
      create: { name, defaultHourlyRate: 0, isBillableDefault: true },
    });
  }

  const expenseCategories = [
    { name: 'Mileage', isOverheadOnly: false },
    { name: 'Home Internet', isOverheadOnly: true },
    { name: 'Home Office Supplies', isOverheadOnly: true },
    { name: 'Meals', isOverheadOnly: false },
    { name: 'Entertainment', isOverheadOnly: false },
    { name: 'Lodging', isOverheadOnly: false },
    { name: 'Transportation', isOverheadOnly: false },
    { name: 'Software / Subscriptions', isOverheadOnly: true },
    { name: 'Other', isOverheadOnly: false },
  ];

  for (const cat of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }

  // v2: permanent internal client so non-client work has a real home.
  // Flag an existing same-named client rather than creating a duplicate.
  const internal = await prisma.client.findFirst({ where: { isInternal: true } });
  if (!internal) {
    const existing = await prisma.client.findFirst({ where: { name: 'Civic North Internal' } });
    if (existing) {
      await prisma.client.update({ where: { id: existing.id }, data: { isInternal: true } });
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
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
