const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

const TASK_INCLUDE = {
  project: { select: { id: true, name: true, clientId: true, client: { select: { id: true, name: true, isInternal: true } } } },
  assigneeUser: { select: { id: true, name: true } },
  deliverable: { include: { taskType: { select: { id: true, name: true } } } },
};

// Hours logged against each task, from time entries that carry its taskId.
// One grouped query instead of a per-task count.
async function withLoggedHours(tasks) {
  if (tasks.length === 0) return tasks;
  const totals = await prisma.timeEntry.groupBy({
    by: ['taskId'],
    where: { taskId: { in: tasks.map((t) => t.id) }, status: 'CONFIRMED' },
    _sum: { hours: true },
  });
  const byTask = Object.fromEntries(totals.map((t) => [t.taskId, t._sum.hours || 0]));
  return tasks.map((t) => ({ ...t, loggedHours: byTask[t.id] || 0 }));
}

// GET /api/tasks?clientId=&projectId=&assignee=&status=
// assignee: "user:<userId>" | "sub:<name>" | "subs" (all subcontractors)
router.get('/', async (req, res) => {
  const { clientId, projectId, assignee, status } = req.query;
  const where = {};
  if (projectId) where.projectId = projectId;
  else if (clientId) where.project = { clientId };
  if (status === 'all') {
    // no status filter
  } else if (status) {
    where.status = status;
  } else {
    where.status = { not: 'DONE' }; // default: open tasks
  }
  if (assignee) {
    if (assignee === 'subs') where.isSubcontractor = true;
    else if (assignee.startsWith('user:')) where.assigneeUserId = assignee.slice(5);
    else if (assignee.startsWith('sub:')) where.assigneeName = assignee.slice(4);
  }

  const tasks = await prisma.task.findMany({
    where,
    include: TASK_INCLUDE,
    orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(await withLoggedHours(tasks));
});

router.post('/', async (req, res) => {
  const {
    projectId, title, notes, assigneeUserId, assigneeName, isSubcontractor,
    subHours, subExpenseAmount, priority, status, dueDate, deliverableId,
  } = req.body;
  if (!projectId || !title) return res.status(400).json({ error: 'projectId and title required' });

  const max = await prisma.task.aggregate({ _max: { rank: true } });
  const task = await prisma.task.create({
    data: {
      projectId,
      title,
      notes: notes || null,
      assigneeUserId: assigneeUserId || null,
      assigneeName: assigneeName || null,
      isSubcontractor: !!isSubcontractor,
      subHours: subHours != null && subHours !== '' ? parseFloat(subHours) : null,
      subExpenseAmount: subExpenseAmount != null && subExpenseAmount !== '' ? parseFloat(subExpenseAmount) : null,
      priority: priority || 'MEDIUM',
      status: status || 'TODO',
      dueDate: dueDate ? new Date(dueDate) : null,
      deliverableId: deliverableId || null,
      rank: (max._max.rank ?? 0) + 1,
    },
    include: TASK_INCLUDE,
  });
  res.status(201).json({ ...task, loggedHours: 0 });
});

// PATCH /api/tasks/reorder  { ids: [taskId, ...] } — ranks assigned by position
router.patch('/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

  // Preserve relative order against the full list: reranked tasks take the
  // rank slots the same set occupied before, so filtered views reorder safely.
  const existing = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, rank: true },
  });
  const slots = existing.map((t) => t.rank).sort((a, b) => a - b);
  await prisma.$transaction(
    ids.map((id, i) => prisma.task.update({ where: { id }, data: { rank: slots[i] ?? i } }))
  );
  res.json({ ok: true });
});

router.put('/:id', async (req, res) => {
  const {
    projectId, title, notes, assigneeUserId, assigneeName, isSubcontractor,
    subHours, subExpenseAmount, priority, status, dueDate, deliverableId,
  } = req.body;

  const data = {};
  if (projectId !== undefined) data.projectId = projectId;
  if (title !== undefined) data.title = title;
  if (notes !== undefined) data.notes = notes || null;
  if (assigneeUserId !== undefined) data.assigneeUserId = assigneeUserId || null;
  if (assigneeName !== undefined) data.assigneeName = assigneeName || null;
  if (isSubcontractor !== undefined) data.isSubcontractor = !!isSubcontractor;
  if (subHours !== undefined) data.subHours = subHours != null && subHours !== '' ? parseFloat(subHours) : null;
  if (subExpenseAmount !== undefined) data.subExpenseAmount = subExpenseAmount != null && subExpenseAmount !== '' ? parseFloat(subExpenseAmount) : null;
  if (priority !== undefined) data.priority = priority;
  if (status !== undefined) data.status = status;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (deliverableId !== undefined) data.deliverableId = deliverableId || null;

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data,
    include: TASK_INCLUDE,
  });
  // The board swaps the returned task in place, so it needs the same shape as GET.
  const [withHours] = await withLoggedHours([task]);
  res.json(withHours);
});

router.delete('/:id', async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
