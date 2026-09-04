const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

function parseDate(dateStr) {
  if (!dateStr) return undefined;
  if (dateStr.includes('T')) return new Date(dateStr);
  return new Date(`${dateStr}T12:00:00Z`);
}

function dateRange(start, end) {
  const where = {};
  if (start) where.gte = new Date(`${start}T00:00:00Z`);
  if (end) where.lte = new Date(`${end}T23:59:59Z`);
  return Object.keys(where).length ? where : undefined;
}

// ── Time Summary ─────────────────────────────────────────────────────────────
// GET /api/reports/time-summary?start=&end=&clientId=&projectId=&userId=&groupBy=client|project|person
router.get('/time-summary', async (req, res) => {
  const { start, end, clientId, projectId, userId, groupBy = 'client' } = req.query;

  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };
  if (projectId) where.projectId = projectId;
  if (userId) where.userId = userId;

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: { select: { id: true, name: true } },
    },
  });

  // Group with secondary (sub-row) breakdown
  // person → by project; client → by project; project → by person
  const groups = {};
  for (const e of entries) {
    let key, label, subKey, subLabel;
    if (groupBy === 'project') {
      key = e.project.id;
      label = `${e.project.client.name} — ${e.project.name}`;
      subKey = e.user.id;
      subLabel = e.user.name;
    } else if (groupBy === 'person') {
      key = e.user.id;
      label = e.user.name;
      subKey = e.project.id;
      subLabel = `${e.project.client.name} — ${e.project.name}`;
    } else {
      key = e.project.client.id;
      label = e.project.client.name;
      subKey = e.project.id;
      subLabel = e.project.name;
    }
    if (!groups[key]) groups[key] = { id: key, label, totalHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0, subs: {} };
    groups[key].totalHours += e.hours;
    if (e.isBillable) { groups[key].billableHours += e.hours; groups[key].amount += e.hours * e.hourlyRate; }
    else groups[key].nonBillableHours += e.hours;

    if (!groups[key].subs[subKey]) groups[key].subs[subKey] = { id: subKey, label: subLabel, totalHours: 0, billableHours: 0, nonBillableHours: 0, amount: 0 };
    groups[key].subs[subKey].totalHours += e.hours;
    if (e.isBillable) { groups[key].subs[subKey].billableHours += e.hours; groups[key].subs[subKey].amount += e.hours * e.hourlyRate; }
    else groups[key].subs[subKey].nonBillableHours += e.hours;
  }

  const rows = Object.values(groups).map(g => ({
    id: g.id, label: g.label,
    totalHours: g.totalHours, billableHours: g.billableHours, nonBillableHours: g.nonBillableHours, amount: g.amount,
    subRows: Object.values(g.subs).sort((a, b) => b.totalHours - a.totalHours),
  })).sort((a, b) => b.totalHours - a.totalHours);
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
// GET /api/reports/billable-breakdown?start=&end=&clientId=&projectId=&userId=&groupBy=task|person|project|client
router.get('/billable-breakdown', async (req, res) => {
  const { start, end, clientId, projectId, userId, groupBy = 'task' } = req.query;
  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };
  if (projectId) where.projectId = projectId;
  if (userId) where.userId = userId;

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: { select: { name: true } },
    },
  });

  let billable = 0, nonBillable = 0, billableAmount = 0;
  const byGroup = {};

  for (const e of entries) {
    if (e.isBillable) { billable += e.hours; billableAmount += e.hours * e.hourlyRate; }
    else nonBillable += e.hours;

    // Primary key
    let key, subKey, subLabel;
    if (groupBy === 'person') {
      key = e.user.name;
      subKey = `${e.project.client.name}__${e.project.name}`;
      subLabel = `${e.project.client.name} — ${e.project.name}`;
    } else if (groupBy === 'project') {
      key = `${e.project.client.name} — ${e.project.name}`;
      subKey = e.user.name;
      subLabel = e.user.name;
    } else if (groupBy === 'client') {
      key = e.project.client.name;
      subKey = e.project.name;
      subLabel = e.project.name;
    } else {
      // task (default) — secondary by client
      key = e.taskType.name;
      subKey = e.project.client.name;
      subLabel = e.project.client.name;
    }

    if (!byGroup[key]) byGroup[key] = { name: key, hours: 0, billable: 0, amount: 0, subs: {} };
    byGroup[key].hours += e.hours;
    if (e.isBillable) { byGroup[key].billable += e.hours; byGroup[key].amount += e.hours * e.hourlyRate; }

    if (!byGroup[key].subs[subKey]) byGroup[key].subs[subKey] = { name: subLabel, hours: 0, billable: 0, amount: 0 };
    byGroup[key].subs[subKey].hours += e.hours;
    if (e.isBillable) { byGroup[key].subs[subKey].billable += e.hours; byGroup[key].subs[subKey].amount += e.hours * e.hourlyRate; }
  }

  const total = billable + nonBillable;
  const groups = Object.values(byGroup).map(g => ({
    name: g.name, hours: g.hours, billable: g.billable, amount: g.amount,
    subRows: Object.values(g.subs).sort((a, b) => b.hours - a.hours),
  })).sort((a, b) => b.hours - a.hours);

  res.json({
    billableHours: billable,
    nonBillableHours: nonBillable,
    totalHours: total,
    billablePct: total ? Math.round((billable / total) * 100) : 0,
    billableAmount,
    groupBy,
    groups,
    byTask: groups, // legacy alias
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
        include: {
          user: { select: { name: true } },
          taskType: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
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
      // Individual logs behind the summary — client-facing report detail
      entries: p.timeEntries.map(e => ({
        date: e.date,
        person: e.user.name,
        task: e.taskType.name,
        hours: e.hours,
        billable: e.isBillable,
        note: e.note || '',
        noteClientVisible: e.noteClientVisible,
      })),
    };
  });

  res.json({ month: `${year}-${String(mo + 1).padStart(2, '0')}`, retainers: results });
});

// ── Custom / Raw entries ──────────────────────────────────────────────────────
// GET /api/reports/entries?start=&end=&clientId=&projectId=&userId=&isBillable=&taskTypeId=
router.get('/entries', async (req, res) => {
  const { start, end, clientId, projectId, userId, isBillable, taskTypeId } = req.query;

  const where = { status: 'CONFIRMED' };
  const dr = dateRange(start, end);
  if (dr) where.date = dr;
  if (clientId) where.project = { clientId };
  if (projectId) where.projectId = projectId;
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
    noteClientVisible: e.noteClientVisible,
  })));
});

// ── Users list for filter dropdown ───────────────────────────────────────────
router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// ── Projects list for filter dropdown ────────────────────────────────────────
router.get('/projects', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { isActive: true },
    select: { id: true, name: true, clientId: true, client: { select: { name: true } } },
    orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
  });
  res.json(projects);
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
