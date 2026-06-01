const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const prisma = new PrismaClient();

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { everyone, expenseType, startDate, endDate } = req.query;
  const where = {};
  if (everyone !== 'true') where.userId = req.userId;
  if (expenseType) where.expenseType = expenseType;
  if (startDate) where.date = { ...where.date, gte: new Date(startDate) };
  if (endDate) where.date = { ...where.date, lte: new Date(endDate) };

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      category: true,
    },
    orderBy: { date: 'desc' },
  });
  res.json(expenses);
});

router.get('/categories', async (req, res) => {
  const categories = await prisma.expenseCategory.findMany({
    where: { isArchived: false },
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

router.post('/', upload.single('receipt'), async (req, res) => {
  const { clientId, categoryId, date, amount, description, isBillable, expenseType } = req.body;
  if (!categoryId || !date || !amount || !description || !expenseType) {
    return res.status(400).json({ error: 'categoryId, date, amount, description, and expenseType required' });
  }

  const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const expense = await prisma.expense.create({
    data: {
      userId: req.userId,
      clientId: clientId || null,
      categoryId,
      date: new Date(date),
      amount: parseFloat(amount),
      description,
      receiptUrl,
      isBillable: isBillable === 'true' || isBillable === true,
      expenseType,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      category: true,
    },
  });
  res.status(201).json(expense);
});

router.put('/:id', upload.single('receipt'), async (req, res) => {
  const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const { clientId, categoryId, date, amount, description, isBillable, expenseType } = req.body;
  const receiptUrl = req.file ? `/uploads/${req.file.filename}` : existing.receiptUrl;

  const expense = await prisma.expense.update({
    where: { id: req.params.id },
    data: {
      clientId: clientId || null,
      categoryId,
      date: date ? new Date(date) : undefined,
      amount: amount ? parseFloat(amount) : undefined,
      description,
      receiptUrl,
      isBillable: isBillable === 'true' || isBillable === true,
      expenseType,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      category: true,
    },
  });
  res.json(expense);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
