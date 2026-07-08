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

// ---------- v2: burn helpers ----------

function healthOf(logged, forecast) {
  if (!forecast || forecast <= 0) return null;
  const pct = Math.round((logged / forecast) * 100);
  const state = logged > forecast ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return { pct, state, logged: Math.round(logged * 10) / 10, forecast, remaining: Math.round((forecast - logged) * 10) / 10 };
}

// Logged hours for a project: confirmed time entries + manual subcontractor
// hours carried on tasks (subs have no login, so their time lives on the task).
async function projectLoggedHours(projectId) {
  const [te, subs] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { projectId, status: 'CONFIRMED' }, _sum: { hours: true } }),
    prisma.task.aggregate({ where: { projectId, isSubcontractor: true }, _sum: { subHours: true } }),
  ]);
  return (te._sum.hours || 0) + (subs._sum.subHours || 0);
}

async function computeBurn(project) {
  if (project.retainerConfig) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const te = await prisma.timeEntry.aggregate({
      where: { projectId: project.id, status: 'CONFIRMED', date: { gte: monthStart } },
      _sum: { hours: true },
    });
    const logged = te._sum.hours || 0;
    const cap = project.retainerConfig.monthlyHours;
    const health = healthOf(logged, cap);
    return {
      mode: 'RETAINER',
      monthLabel: now.toLocaleString('en-US', { month: 'long' }),
      rollover: project.retainerConfig.rolloverEnabled,
      ...(health || { pct: 0, state: 'ok', logged, forecast: cap, remaining: cap - logged }),
    };
  }
  const logged = await projectLoggedHours(project.id);
  const health = healthOf(logged, project.budgetHours);
  return {
    mode: 'DELIVERABLES',
    ...(health || { pct: null, state: 'ok', logged: Math.round(logged * 10) / 10, forecast: project.budgetHours, remaining: null }),
  };
}

// Per-deliverable logged hours: entries by taskType + sub hours on linked tasks
async function deliverableBurns(project) {
  const [byType, subByDeliverable] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ['taskTypeId'],
      where: { projectId: project.id, status: 'CONFIRMED' },
      _sum: { hours: true },
    }),
    prisma.task.groupBy({
      by: ['deliverableId'],
      where: { projectId: project.id, isSubcontractor: true, deliverableId: { not: null } },
      _sum: { subHours: true },
    }),
  ]);
  const typeHours = Object.fromEntries(byType.map((t) => [t.taskTypeId, t._sum.hours || 0]));
  const subHours = Object.fromEntries(subByDeliverable.map((s) => [s.deliverableId, s._sum.subHours || 0]));
  return project.projectTasks.map((pt) => {
    const logged = (typeHours[pt.taskTypeId] || 0) + (subHours[pt.id] || 0);
    return { ...pt, loggedHours: Math.round(logged * 10) / 10, health: healthOf(logged, pt.forecastHours) };
  });
}

// ---------- v2: Project Overview payload (wireframe 2a) ----------
router.get('/:id/overview', async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: { include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } } },
      retainerConfig: true,
      projectTasks: { where: { isActive: true }, include: { taskType: true } },
      milestones: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }], include: { owner: { select: { id: true, name: true } } } },
      payments: { orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }] },
      fileLinks: { orderBy: { createdAt: 'asc' } },
      callLogs: { orderBy: { date: 'desc' } },
    },
  });
  if (!project) return res.status(404).json({ error: 'Not found' });

  const [burn, deliverables, openTasks] = await Promise.all([
    computeBurn(project),
    deliverableBurns(project),
    prisma.task.count({ where: { projectId: project.id, status: { not: 'DONE' } } }),
  ]);

  // Deliverable contributors (avatar stacks in section 05)
  const contributors = await prisma.timeEntry.groupBy({
    by: ['taskTypeId', 'userId'],
    where: { projectId: project.id, status: 'CONFIRMED' },
    _sum: { hours: true },
  });
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const subTasks = await prisma.task.findMany({
    where: { projectId: project.id, isSubcontractor: true, deliverableId: { not: null } },
    select: { deliverableId: true, assigneeName: true },
  });
  const deliverablesWithPeople = deliverables.map((d) => ({
    ...d,
    contributors: [
      ...contributors.filter((c) => c.taskTypeId === d.taskTypeId).map((c) => ({ type: 'user', id: c.userId, name: userMap[c.userId] || '?' })),
      ...subTasks.filter((t) => t.deliverableId === d.id).map((t) => ({ type: 'sub', name: t.assigneeName || 'Sub' })),
    ],
  }));

  // At-risk = burn trouble or a flagged non-done milestone
  const riskyMilestone = project.milestones.find((m) => m.atRisk && m.status !== 'DONE');
  const atRisk = burn.state === 'over' || burn.state === 'warn' || !!riskyMilestone;
  let alert = null;
  if (riskyMilestone) {
    const overForecast = burn.forecast && burn.logged > burn.forecast ? `, tracking +${Math.round(burn.logged - burn.forecast)}h over forecast` : '';
    const due = riskyMilestone.dueDate
      ? ` due ${riskyMilestone.dueDate.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
      : '';
    alert = {
      title: 'Deadline slipping',
      message: `${riskyMilestone.name} milestone${due}${overForecast}`,
    };
  }

  res.json({
    ...project,
    projectTasks: undefined,
    deliverables: deliverablesWithPeople,
    burn,
    openTasks,
    atRisk,
    alert,
    isRetainer: !!project.retainerConfig,
  });
});

// ---------- v2: Deliverable detail (wireframe 2d) ----------
router.get('/:id/deliverables/:ptId', async (req, res) => {
  const pt = await prisma.projectTask.findUnique({
    where: { id: req.params.ptId },
    include: {
      taskType: true,
      project: { include: { client: { select: { id: true, name: true } }, retainerConfig: true } },
    },
  });
  if (!pt || pt.projectId !== req.params.id) return res.status(404).json({ error: 'Not found' });

  const [byUser, tasks] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ['userId'],
      where: { projectId: pt.projectId, taskTypeId: pt.taskTypeId, status: 'CONFIRMED' },
      _sum: { hours: true },
      _max: { date: true },
    }),
    prisma.task.findMany({
      where: { projectId: pt.projectId, deliverableId: pt.id },
      include: { assigneeUser: { select: { id: true, name: true } } },
      orderBy: [{ rank: 'asc' }],
    }),
  ]);
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const partnerRows = byUser.map((r) => ({
    type: 'user',
    id: r.userId,
    name: userMap[r.userId] || '?',
    hours: Math.round((r._sum.hours || 0) * 10) / 10,
    lastEntry: r._max.date,
  }));
  const subRows = tasks
    .filter((t) => t.isSubcontractor && (t.subHours || t.subExpenseAmount))
    .map((t) => ({
      type: 'sub',
      name: t.assigneeName || 'Subcontractor',
      hours: t.subHours || 0,
      expense: t.subExpenseAmount || null,
      taskId: t.id,
    }));
  const logged = partnerRows.reduce((s, r) => s + r.hours, 0) + subRows.reduce((s, r) => s + r.hours, 0);

  res.json({
    ...pt,
    contributors: [...partnerRows, ...subRows],
    tasks,
    loggedHours: Math.round(logged * 10) / 10,
    health: healthOf(logged, pt.forecastHours),
  });
});

router.patch('/:id/deliverables/:ptId', async (req, res) => {
  const { forecastHours } = req.body;
  const pt = await prisma.projectTask.update({
    where: { id: req.params.ptId },
    data: { forecastHours: forecastHours != null && forecastHours !== '' ? parseFloat(forecastHours) : null },
    include: { taskType: true },
  });
  res.json(pt);
});

// ---------- v2: scope / notes ----------
router.patch('/:id/scope', async (req, res) => {
  const { scopeOfWork, sowNumber, notes } = req.body;
  const data = {};
  if (scopeOfWork !== undefined) data.scopeOfWork = scopeOfWork || null;
  if (sowNumber !== undefined) data.sowNumber = sowNumber || null;
  if (notes !== undefined) data.notes = notes || null;
  const project = await prisma.project.update({ where: { id: req.params.id }, data });
  res.json(project);
});

// ---------- v2: milestones ----------
router.post('/:id/milestones', async (req, res) => {
  const { name, status, dueDate, completedAt, ownerId, tags, atRisk, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const max = await prisma.milestone.aggregate({ where: { projectId: req.params.id }, _max: { sortOrder: true } });
  const m = await prisma.milestone.create({
    data: {
      projectId: req.params.id,
      name,
      status: status || 'UPCOMING',
      dueDate: dueDate ? new Date(dueDate) : null,
      completedAt: completedAt ? new Date(completedAt) : null,
      ownerId: ownerId || null,
      tags: tags || [],
      atRisk: !!atRisk,
      notes: notes || null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
    include: { owner: { select: { id: true, name: true } } },
  });
  res.status(201).json(m);
});

router.put('/:id/milestones/:mid', async (req, res) => {
  const { name, status, dueDate, completedAt, ownerId, tags, atRisk, notes, sortOrder } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (status !== undefined) {
    data.status = status;
    if (status === 'DONE' && completedAt === undefined) data.completedAt = new Date();
  }
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (completedAt !== undefined) data.completedAt = completedAt ? new Date(completedAt) : null;
  if (ownerId !== undefined) data.ownerId = ownerId || null;
  if (tags !== undefined) data.tags = tags || [];
  if (atRisk !== undefined) data.atRisk = !!atRisk;
  if (notes !== undefined) data.notes = notes || null;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;
  const m = await prisma.milestone.update({
    where: { id: req.params.mid },
    data,
    include: { owner: { select: { id: true, name: true } } },
  });
  res.json(m);
});

router.delete('/:id/milestones/:mid', async (req, res) => {
  await prisma.milestone.delete({ where: { id: req.params.mid } });
  res.json({ ok: true });
});

// ---------- v2: payment schedule ----------
router.post('/:id/payments', async (req, res) => {
  const { label, amount, dueDate, isPaid, payeeType, payeeName } = req.body;
  if (!label || amount == null) return res.status(400).json({ error: 'label and amount required' });
  const max = await prisma.paymentInstallment.aggregate({ where: { projectId: req.params.id }, _max: { sortOrder: true } });
  const p = await prisma.paymentInstallment.create({
    data: {
      projectId: req.params.id,
      label,
      amount: parseFloat(amount),
      dueDate: dueDate ? new Date(dueDate) : null,
      isPaid: !!isPaid,
      paidAt: isPaid ? new Date() : null,
      payeeType: payeeType || 'CLIENT',
      payeeName: payeeName || null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(p);
});

router.put('/:id/payments/:pid', async (req, res) => {
  const { label, amount, dueDate, isPaid, payeeType, payeeName } = req.body;
  const data = {};
  if (label !== undefined) data.label = label;
  if (amount !== undefined) data.amount = parseFloat(amount);
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (isPaid !== undefined) {
    data.isPaid = !!isPaid;
    data.paidAt = isPaid ? new Date() : null;
  }
  if (payeeType !== undefined) data.payeeType = payeeType;
  if (payeeName !== undefined) data.payeeName = payeeName || null;
  const p = await prisma.paymentInstallment.update({ where: { id: req.params.pid }, data });
  res.json(p);
});

router.delete('/:id/payments/:pid', async (req, res) => {
  await prisma.paymentInstallment.delete({ where: { id: req.params.pid } });
  res.json({ ok: true });
});

// ---------- v2: file links ----------
router.post('/:id/file-links', async (req, res) => {
  const { label, url } = req.body;
  if (!label || !url) return res.status(400).json({ error: 'label and url required' });
  const f = await prisma.fileLink.create({ data: { projectId: req.params.id, label, url } });
  res.status(201).json(f);
});

router.delete('/:id/file-links/:fid', async (req, res) => {
  await prisma.fileLink.delete({ where: { id: req.params.fid } });
  res.json({ ok: true });
});

// ---------- v2: call logs ----------
router.post('/:id/call-logs', async (req, res) => {
  const { title, date, summary, source } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const c = await prisma.callLog.create({
    data: { projectId: req.params.id, title, date: new Date(date), summary: summary || null, source: source || 'MANUAL' },
  });
  res.status(201).json(c);
});

router.put('/:id/call-logs/:cid', async (req, res) => {
  const { title, date, summary } = req.body;
  const data = {};
  if (title !== undefined) data.title = title;
  if (date !== undefined) data.date = new Date(date);
  if (summary !== undefined) data.summary = summary || null;
  const c = await prisma.callLog.update({ where: { id: req.params.cid }, data });
  res.json(c);
});

router.delete('/:id/call-logs/:cid', async (req, res) => {
  await prisma.callLog.delete({ where: { id: req.params.cid } });
  res.json({ ok: true });
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
