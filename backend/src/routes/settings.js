const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true, weeklyHourTarget: true, notificationsEnabled: true },
  });
  res.json(user);
});

router.put('/', async (req, res) => {
  const { weeklyHourTarget, notificationsEnabled } = req.body;
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      weeklyHourTarget: weeklyHourTarget !== undefined ? parseFloat(weeklyHourTarget) : undefined,
      notificationsEnabled: notificationsEnabled !== undefined ? notificationsEnabled : undefined,
    },
    select: { id: true, name: true, email: true, weeklyHourTarget: true, notificationsEnabled: true },
  });
  res.json(user);
});

module.exports = router;
