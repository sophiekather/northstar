const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

function dateRange(start, end) {
  const where = {};
  if (start) where.gte = new Date(start);
  if (end) {
    const e = new Date(end);
    e.setHours(23, 59, 59, 999);
    where.lte = e;
  }
  return Object.keys(where).length ? where : undefined;
}

// ── Time Summary ─────────────────────────────────────────────────────────────
// GET /api/reports/time-summary?start=&end=&clientId=&groupBy=client|project|person
router.get('/time-summary', async (req, res) => {
  const { start, end, clientId, groupBy = 'client' } = req.query;

  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: { select: { id: true, name: true } },
    },
  });

  // Group
  const groups = {};
  for (const e of entries) {
    let key, label;
    if (groupBy === 'project') {
      key = e.project.id;
      label = `${e.project.client.name} — ${e.project.name}`;
    } else if (groupBy === 'person') {
      key = e.user.id;
      label = e.user.name;
    } else {
      key = e.project.client.id;
      label = e.project.client.name;
    }
    if (!groups[key]) groups[key] = { id: key, label, totalHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0 };
    groups[key].totalHours += e.hours;
    if (e.isBillable) { groups[key].billableHours += e.hours; groups[key].amount += e.hours * e.hourlyRate; }
    else groups[key].nonBillableHours += e.hours;
  }

  const rows = Object.values(groups).sort((a, b) => b.totalHours - a.totalHours);
  const totals = rows.reduce((acc, r) => {
    acc.totalHours += r.totalHours;
    acc.billableHours += r.billableHours;
    acc.nonBillableHours += r.nonBillableHours;
    acc.amount += r.amount;
    return acc;
  }, { totalHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0 });

  res.json({ rows, totals });
});

// ── Billable Breakdown ────────────────────────────────────────────────────────
router.get('/billable-breakdown', async (req, res) => {
  const { start, end, clientId } = req.query;
  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: { select: { name: true } },
    },
  });

  let billable = 0, nonBillable = 0, billableAmount = 0;
  const byTask = {};

  for (const e of entries) {
    if (e.isBillable) { billable += e.hours; billableAmount += e.hours * e.hourlyRate; }
    else nonBillable += e.hours;

    const t = e.taskType.name;
    if (!byTask[t]) byTask[t] = { name: t, hours: 0, billable: 0 };
    byTask[t].hours += e.hours;
    if (e.isBillable) byTask[t].billable += e.hours;
  }

  const total = billable + nonBillable;
  res.json({
    billableHours: billable,
    nonBillableHours: nonBillable,
    totalHours: total,
    billablePct: total ? Math.round((billable / total) * 100) : 0,
    billableAmount,
    byTask: Object.values(byTask).sort((a, b) => b.hours - a.hours),
  });
});

// ── Retainer Burn ─────────────────────────────────────────────────────────────
router.get('/retainer-burn', async (req, res) => {
  const { month } = req.query; // e.g. "2026-06"
  const now = new Date();
  const year = month ? parseInt(month.split('-')[0]) : now.getFullYear();
  const mo   = month ? parseInt(month.split('-')[1]) - 1 : now.getMonth();

  const start = new Date(year, mo, 1);
  const end   = new Date(year, mo + 1, 0, 23, 59, 59, 999);

  const retainerProjects = await prisma.project.findMany({
    where: { retainerConfig: { isNot: null } },
    include: {
      client: { select: { id: true, name: true } },
      retainerConfig: true,
      timeEntries: {
        where: { date: { gte: start, lte: end }, status: 'CONFIRMED' },
      },
    },
  });

  const results = retainerProjects.map(p => {
    const hoursUsed = p.timeEntries.reduce((s, e) => s + e.hours, 0);
    const budget = p.retainerConfig.monthlyHours;
    const pct = Math.round((hoursUsed / budget) * 100);
    return {
      clientName: p.client.name,
      projectName: p.name,
      projectId: p.id,
      monthlyHours: budget,
      hoursUsed,
      hoursRemaining: Math.max(0, budget - hoursUsed),
      pct: Math.min(pct, 100),
      overBudget: hoursUsed > budget,
      overBy: hoursUsed > budget ? hoursUsed - budget : 0,
    };
  });

  res.json({ month: `${year}-${String(mo + 1).padStart(2, '0')}`, retainers: results });
});

// ── Custom / Raw entries ──────────────────────────────────────────────────────
// GET /api/reports/entries?start=&end=&clientId=&userId=&isBillable=&taskTypeId=
router.get('/entries', async (req, res) => {
  const { start, end, clientId, userId, isBillable, taskTypeId } = req.query;

  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };
  if (userId) where.userId = userId;
  if (isBillable !== undefined) where.isBillable = isBillable === 'true';
  if (taskTypeId) where.taskTypeId = taskTypeId;

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: { select: { name: true } },
      project: { include: { client: { select: { name: true } } } },
      taskType: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  });

  res.json(entries.map(e => ({
    date: e.date,
    person: e.user.name,
    client: e.project.client.name,
    project: e.project.name,
    task: e.taskType.name,
    hours: e.hours,
    billable: e.isBillable,
    rate: e.hourlyRate,
    amount: e.isBillable ? e.hours * e.hourlyRate : 0,
    note: e.note || '',
  })));
});

// ── Clients list for filter dropdown ─────────────────────────────────────────
router.get('/clients', async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(clients);
});

module.exports = router;
