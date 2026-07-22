const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Machine auth for the Claude automation layer (PRD v2.1 R5).
// Key lives in NORTHSTAR_API_KEY; if unset, bearer auth is disabled entirely.
function apiKeyMatches(header) {
  const configured = process.env.NORTHSTAR_API_KEY;
  if (!configured || !header || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(configured);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function requireAuth(req, res, next) {
  if (apiKeyMatches(req.headers.authorization)) {
    // API clients act on behalf of the whole team, not one partner (PRD D5).
    // Routes that filter by req.userId expect ?everyone=true or an explicit userId.
    req.userId = null;
    req.isApiClient = true;
    return next();
  }

  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin gate for user management. API clients act for the whole team and are
// trusted with the same reach as an admin (the key is server-side only).
async function requireAdmin(req, res, next) {
  if (req.isApiClient) return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, isActive: true },
    });
    if (!user || !user.isActive || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { requireAuth, requireAdmin };
