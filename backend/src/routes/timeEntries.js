const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

// Parse a YYYY-MM-DD date string as noon UTC to avoid timezone-shift bugs
function parseDate(dateStr) {
  if (!dateStr) return undefined;
  // If already a full ISO string, use as-is; otherwise anchor to noon UTC
  if (dateStr.includes('T')) return new Date(dateStr);
  return new Date(`${dateStr}T12:00:00Z`);
}

router.get('/', async (req, res) => {
  const { startDate, endDate, userId, everyone } = req.query;

  const where = { status: 'CONFIRMED' };

  if (everyone !== 'true') {
    where.userId = userId || req.userId;
  }

  if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
  if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: true,
    },
    orderBy: { date: 'desc' },
  });

  res.json(entries);
});

router.post('/', async (req, res) => {
  const { projectId, taskTypeId, date, hours, hourlyRate, isBillable, note, noteClientVisible } = req.body;
  if (!projectId || !taskTypeId || !date || !hours) {
    return res.status(400).json({ error: 'projectId, taskTypeId, date, and hours required' });
  }
  if (hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });

  const entry = await prisma.timeEntry.create({
    data: {
      userId: req.userId,
      projectId,
      taskTypeId,
      date: parseDate(date),
      hours,
      hourlyRate: hourlyRate || 0,
      isBillable: isBillable ?? true,
      note,
      noteClientVisible: noteClientVisible ?? false,
    },
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: true,
    },
  });
  res.status(201).json(entry);
});

router.put('/:id', async (req, res) => {
  const { projectId, taskTypeId, date, hours, hourlyRate, isBillable, note, noteClientVisible } = req.body;
  if (hours !== undefined && hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });

  const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const entry = await prisma.timeEntry.update({
    where: { id: req.params.id },
    data: {
      projectId,
      taskTypeId,
      date: date ? parseDate(date) : undefined,
      hours,
      hourlyRate,
      isBillable,
      note,
      noteClientVisible,
    },
    include: {
      user: { select: { id: true, name: true } },
      project: { include: { client: { select: { id: true, name: true } } } },
      taskType: true,
    },
  });
  res.json(entry);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  await prisma.timeEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
