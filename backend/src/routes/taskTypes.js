const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { includeArchived } = req.query;
  const taskTypes = await prisma.taskType.findMany({
    where: includeArchived === 'true' ? {} : { isArchived: false },
    orderBy: { name: 'asc' },
  });
  res.json(taskTypes);
});

router.post('/', async (req, res) => {
  const { name, defaultHourlyRate, isBillableDefault } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const taskType = await prisma.taskType.create({
    data: { name, defaultHourlyRate: defaultHourlyRate || 0, isBillableDefault: isBillableDefault ?? true },
  });
  res.status(201).json(taskType);
});

router.put('/:id', async (req, res) => {
  const { name, defaultHourlyRate, isBillableDefault } = req.body;
  const taskType = await prisma.taskType.update({
    where: { id: req.params.id },
    data: { name, defaultHourlyRate, isBillableDefault },
  });
  res.json(taskType);
});

router.patch('/:id/archive', async (req, res) => {
  const taskType = await prisma.taskType.update({ where: { id: req.params.id }, data: { isArchived: true } });
  res.json(taskType);
});

router.patch('/:id/unarchive', async (req, res) => {
  const taskType = await prisma.taskType.update({ where: { id: req.params.id }, data: { isArchived: false } });
  res.json(taskType);
});

module.exports = router;
