const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { everyone, startDate, endDate } = req.query;
  const where = {};
  if (everyone !== 'true') where.userId = req.userId;
  if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
  if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

  const entries = await prisma.mileageEntry.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
    orderBy: { date: 'desc' },
  });
  res.json(entries);
});

router.post('/', async (req, res) => {
  const { clientId, date, miles, purpose, ratePerMile, isBillable } = req.body;
  if (!date || !miles || !purpose) return res.status(400).json({ error: 'date, miles, and purpose required' });

  const rate = ratePerMile || 0.7;
  const calculatedAmount = parseFloat(miles) * parseFloat(rate);

  const entry = await prisma.mileageEntry.create({
    data: {
      userId: req.userId,
      clientId: clientId || null,
      date: new Date(date),
      miles: parseFloat(miles),
      purpose,
      ratePerMile: parseFloat(rate),
      calculatedAmount,
      isBillable: isBillable ?? false,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });
  res.status(201).json(entry);
});

router.put('/:id', async (req, res) => {
  const existing = await prisma.mileageEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const { clientId, date, miles, purpose, ratePerMile, isBillable } = req.body;
  const rate = ratePerMile ?? existing.ratePerMile;
  const m = miles ?? existing.miles;
  const calculatedAmount = parseFloat(m) * parseFloat(rate);

  const entry = await prisma.mileageEntry.update({
    where: { id: req.params.id },
    data: {
      clientId: clientId !== undefined ? clientId || null : undefined,
      date: date ? new Date(date) : undefined,
      miles: miles ? parseFloat(miles) : undefined,
      purpose,
      ratePerMile: parseFloat(rate),
      calculatedAmount,
      isBillable,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  });
  res.json(entry);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.mileageEntry.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  await prisma.mileageEntry.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
