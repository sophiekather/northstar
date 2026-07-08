const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { includeArchived, include } = req.query;
  const withProjects = include === 'projects';
  const clients = await prisma.client.findMany({
    where: includeArchived === 'true' ? {} : { isActive: true },
    orderBy: [{ isInternal: 'asc' }, { name: 'asc' }],
    include: withProjects
      ? {
          contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
          projects: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            include: { retainerConfig: true },
          },
        }
      : undefined,
  });
  if (!withProjects) return res.json(clients);

  // Rollups for the tree / client cards: burn % and open tasks per project
  const projectIds = clients.flatMap((c) => c.projects.map((p) => p.id));
  const [hours, subHours, taskCounts, riskyMilestones] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: 'CONFIRMED' },
      _sum: { hours: true },
    }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, isSubcontractor: true },
      _sum: { subHours: true },
    }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: { not: 'DONE' } },
      _count: true,
    }),
    prisma.milestone.findMany({
      where: { projectId: { in: projectIds }, atRisk: true, status: { not: 'DONE' } },
      select: { projectId: true },
    }),
  ]);
  const hoursMap = Object.fromEntries(hours.map((h) => [h.projectId, h._sum.hours || 0]));
  const subMap = Object.fromEntries(subHours.map((h) => [h.projectId, h._sum.subHours || 0]));
  const taskMap = Object.fromEntries(taskCounts.map((t) => [t.projectId, t._count]));
  const riskSet = new Set(riskyMilestones.map((m) => m.projectId));

  const result = clients.map((c) => ({
    ...c,
    projects: c.projects.map((p) => {
      const logged = (hoursMap[p.id] || 0) + (subMap[p.id] || 0);
      const forecast = p.budgetHours;
      const pct = forecast ? Math.round((logged / forecast) * 100) : null;
      return {
        ...p,
        loggedHours: Math.round(logged * 10) / 10,
        burnPct: pct,
        burnState: riskSet.has(p.id)
          ? 'warn'
          : !forecast ? 'ok' : logged > forecast ? 'over' : pct >= 80 ? 'warn' : 'ok',
        openTasks: taskMap[p.id] || 0,
        isRetainer: !!p.retainerConfig,
      };
    }),
    openTasks: c.projects.reduce((s, p) => s + (taskMap[p.id] || 0), 0),
  }));
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

// ---------- v2: contacts ----------
router.post('/:id/contacts', async (req, res) => {
  const { name, email, role, isPrimary } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const contact = await prisma.clientContact.create({
    data: { clientId: req.params.id, name, email: email || null, role: role || null, isPrimary: !!isPrimary },
  });
  res.status(201).json(contact);
});

router.put('/:id/contacts/:cid', async (req, res) => {
  const { name, email, role, isPrimary } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (email !== undefined) data.email = email || null;
  if (role !== undefined) data.role = role || null;
  if (isPrimary !== undefined) data.isPrimary = !!isPrimary;
  const contact = await prisma.clientContact.update({ where: { id: req.params.cid }, data });
  res.json(contact);
});

router.delete('/:id/contacts/:cid', async (req, res) => {
  await prisma.clientContact.delete({ where: { id: req.params.cid } });
  res.json({ ok: true });
});

router.post('/', async (req, res) => {
  const { name, emails, keywords, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const client = await prisma.client.create({
    data: { name, emails: emails || [], keywords: keywords || [], notes },
  });
  res.status(201).json(client);
});

router.put('/:id', async (req, res) => {
  const { name, emails, keywords, notes } = req.body;
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data: { name, emails: emails || [], keywords: keywords || [], notes },
  });
  res.json(client);
});

router.patch('/:id/archive', async (req, res) => {
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.json(client);
});

router.patch('/:id/unarchive', async (req, res) => {
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data: { isActive: true },
  });
  res.json(client);
});

module.exports = router;
