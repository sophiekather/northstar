const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

module.exports = { requireAuth };
