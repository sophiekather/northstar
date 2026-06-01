const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { clientId, includeArchived } = req.query;
  const where = {};
  if (clientId) where.clientId = clientId;
  if (includeArchived !== 'true') where.isActive = true;

  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      retainerConfig: true,
      projectTasks: { include: { taskType: true } },
      _count: { select: { timeEntries: true } },
    },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
  });

  // Compute hours spent per project
  const projectIds = projects.map((p) => p.id);
  const hoursSums = await prisma.timeEntry.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds }, status: 'CONFIRMED' },
    _sum: { hours: true, hourlyRate: true },
  });

  const hoursMap = {};
  for (const h of hoursSums) {
    hoursMap[h.projectId] = h._sum.hours || 0;
  }

  const result = projects.map((p) => ({
    ...p,
    hoursSpent: hoursMap[p.id] || 0,
  }));

  res.json(result);
});

router.get('/:id', async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      retainerConfig: true,
      projectTasks: { include: { taskType: true } },
      timeEntries: {
        where: { status: 'CONFIRMED' },
        include: { user: { select: { id: true, name: true } }, taskType: true },
        orderBy: { date: 'desc' },
      },
    },
  });
  if (!project) return res.status(404).json({ error: 'Not found' });

  const hoursSpent = project.timeEntries.reduce((sum, e) => sum + e.hours, 0);
  res.json({ ...project, hoursSpent });
});

router.post('/', async (req, res) => {
  const { clientId, name, type, budgetHours, budgetDollars, startDate, endDate, notes, taskTypeIds } = req.body;
  if (!clientId || !name || !type) return res.status(400).json({ error: 'clientId, name, and type required' });

  const project = await prisma.project.create({
    data: {
      clientId,
      name,
      type,
      budgetHours: budgetHours || null,
      budgetDollars: budgetDollars || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes,
      projectTasks: taskTypeIds?.length
        ? { create: taskTypeIds.map((id) => ({ taskTypeId: id })) }
        : undefined,
    },
    include: { client: true, projectTasks: { include: { taskType: true } } },
  });
  res.status(201).json(project);
});

router.put('/:id', async (req, res) => {
  const { name, type, budgetHours, budgetDollars, startDate, endDate, notes, taskTypeIds } = req.body;

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      name,
      type,
      budgetHours: budgetHours ?? null,
      budgetDollars: budgetDollars ?? null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes,
    },
  });

  if (taskTypeIds !== undefined) {
    await prisma.projectTask.deleteMany({ where: { projectId: req.params.id } });
    if (taskTypeIds.length > 0) {
      await prisma.projectTask.createMany({
        data: taskTypeIds.map((id) => ({ projectId: req.params.id, taskTypeId: id })),
        skipDuplicates: true,
      });
    }
  }

  const updated = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { client: true, projectTasks: { include: { taskType: true } } },
  });
  res.json(updated);
});

router.patch('/:id/archive', async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json(project);
});

router.patch('/:id/unarchive', async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: { isActive: true } });
  res.json(project);
});

module.exports = router;
