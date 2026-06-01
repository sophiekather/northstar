const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { includeArchived } = req.query;
  const clients = await prisma.client.findMany({
    where: includeArchived === 'true' ? {} : { isActive: true },
    orderBy: { name: 'asc' },
  });
  res.json(clients);
});

router.get('/:id', async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
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
