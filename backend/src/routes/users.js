const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth, requireAdmin);

const USER_SELECT = {
  id: true, name: true, email: true, role: true, isActive: true,
  weeklyHourTarget: true, notificationsEnabled: true, createdAt: true,
};

// A readable temp password the admin can hand over — the member changes it in
// Settings. Nothing emails it, so it's shown once in the panel.
function tempPassword() {
  return `ns-${crypto.randomBytes(4).toString('hex')}`;
}

// GET /api/users — everyone, with a live workload count for the admin table
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      ...USER_SELECT,
      _count: { select: { tasks: { where: { status: { not: 'DONE' } } } } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  res.json(users.map(({ _count, ...u }) => ({ ...u, openTasks: _count.tasks })));
});

router.post('/', async (req, res) => {
  const { name, email, role, weeklyHourTarget, password } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  const normalized = email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return res.status(409).json({ error: 'A user with that email already exists' });

  const initial = password || tempPassword();
  if (initial.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalized,
      passwordHash: await bcrypt.hash(initial, 10),
      role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      weeklyHourTarget: weeklyHourTarget != null ? parseFloat(weeklyHourTarget) : undefined,
    },
    select: USER_SELECT,
  });
  // Returned once so the admin can pass it on; never stored in plain text.
  res.status(201).json({ ...user, openTasks: 0, tempPassword: initial });
});

router.put('/:id', async (req, res) => {
  const { name, email, role, isActive, weeklyHourTarget } = req.body;
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Guard against an org locking itself out of the admin panel.
  const losingAdmin = (role !== undefined && role !== 'ADMIN') || isActive === false;
  if (target.role === 'ADMIN' && losingAdmin) {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'You cannot remove the last active admin' });
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = email.toLowerCase().trim();
  if (role !== undefined) data.role = role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
  if (isActive !== undefined) data.isActive = !!isActive;
  if (weeklyHourTarget !== undefined) data.weeklyHourTarget = parseFloat(weeklyHourTarget);

  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: USER_SELECT });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'That email is already in use' });
    throw err;
  }
});

// POST /api/users/:id/reset-password — returns a new temp password to hand over
router.post('/:id/reset-password', async (req, res) => {
  const { password } = req.body;
  const initial = password || tempPassword();
  if (initial.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash: await bcrypt.hash(initial, 10) },
  });
  res.json({ ok: true, tempPassword: initial });
});

// Deactivate rather than delete — time entries, expenses and tasks reference
// the user, and the history has to stay intact for reporting.
router.delete('/:id', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.userId) return res.status(400).json({ error: 'You cannot deactivate yourself' });

  if (target.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    if (admins <= 1) return res.status(400).json({ error: 'You cannot deactivate the last active admin' });
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: false },
    select: USER_SELECT,
  });
  res.json(user);
});

module.exports = router;
