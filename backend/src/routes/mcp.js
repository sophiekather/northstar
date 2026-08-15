const express = require('express');
const crypto = require('crypto');

const { listTools, callTool, toolNames, ToolError } = require('../services/mcpTools');

const router = express.Router();

// Streamable HTTP MCP endpoint, mounted at /api/mcp ahead of the app's own
// body parser and route auth (see src/index.js). Claude authenticates with
// MCP_TOKEN, supplied either as the last path segment — /api/mcp/<token>, which
// is what the custom connector UI accepts — or as a bearer token.
//
// JSON responses only: no SSE stream, so GET is 405 and DELETE is a no-op 204.

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'northstar', title: 'NorthStar', version: '1.0.0' };

// JSON-RPC 2.0 error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/**
 * Constant-time compare against MCP_TOKEN. Mirrors apiKeyMatches in
 * middleware/auth.js: no token configured means the endpoint stays shut.
 */
function tokenMatches(supplied) {
  const configured = process.env.MCP_TOKEN;
  if (!configured || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function suppliedToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.params.token || null;
}

function requireMcpToken(req, res, next) {
  if (!process.env.MCP_TOKEN) {
    console.error('[mcp] Rejected a request: MCP_TOKEN is not configured');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!tokenMatches(suppliedToken(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------- JSON-RPC ----------

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * A tool that fails comes back as a normal result carrying isError, not as a
 * JSON-RPC error — that way Claude sees the message and can retry differently
 * instead of the whole call being dropped by the transport.
 */
function toolResult(id, payload, isError = false) {
  return result(id, {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  });
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return error(message?.id, INVALID_REQUEST, 'Expected a JSON-RPC 2.0 message');
  }

  const { id, method, params = {} } = message;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
        serverInfo: SERVER_INFO,
      });

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: listTools() });

    case 'resources/list':
      return result(id, { resources: [] });

    case 'prompts/list':
      return result(id, { prompts: [] });

    case 'tools/call': {
      const name = params?.name;
      if (!name) return toolResult(id, 'A tool name is required', true);
      try {
        return toolResult(id, await callTool(name, params.arguments ?? {}));
      } catch (err) {
        if (!(err instanceof ToolError)) {
          console.error(`[mcp] Tool ${name} failed:`, err);
        }
        return toolResult(id, `${name} failed: ${err.message}`, true);
      }
    }

    default:
      return error(id, METHOD_NOT_FOUND, `Unknown method "${method}"`);
  }
}

// A message with no id is a notification: acknowledge it and send nothing back.
function isNotification(message) {
  return !message || typeof message !== 'object' || message.id === undefined || message.id === null;
}

async function handlePost(req, res) {
  const body = req.body;

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return res.status(400).json(error(null, INVALID_REQUEST, 'Batch must not be empty'));
    }
    const responses = [];
    for (const message of body) {
      if (isNotification(message)) continue;
      responses.push(await handleMessage(message));
    }
    // An all-notification batch has nothing to reply with.
    if (responses.length === 0) return res.status(202).end();
    return res.json(responses);
  }

  if (isNotification(body)) return res.status(202).end();
  return res.json(await handleMessage(body));
}

// ---------- routes ----------
//
// Each shape is registered twice: once with the token in the path and once
// without, for callers that send it as a bearer token instead. The /health
// route is declared before /:token so the token pattern cannot swallow it.

const parseJson = express.json({ limit: '1mb' });

// Express 4 does not forward rejected promises, so hand them to next() by hand.
const asyncRoute = (fn) => (req, res, next) => fn(req, res).catch(next);

// Malformed JSON never reaches a handler, so answer it in JSON-RPC terms.
function onBadJson(err, req, res, next) {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json(error(null, PARSE_ERROR, 'Request body is not valid JSON'));
  }
  next(err);
}

function health(req, res) {
  res.json({ ok: true, tools: toolNames });
}

// Unhandled faults inside a handler still owe the caller a JSON-RPC error.
function onFailure(err, req, res, next) {
  console.error('[mcp] Request failed:', err);
  if (res.headersSent) return next(err);
  res.status(500).json(error(null, INTERNAL_ERROR, 'Internal error'));
}

router.get('/health', requireMcpToken, health);
router.get('/:token/health', requireMcpToken, health);

router.post('/', requireMcpToken, parseJson, onBadJson, asyncRoute(handlePost));
router.post('/:token', requireMcpToken, parseJson, onBadJson, asyncRoute(handlePost));

// No SSE stream on this transport.
router.get('/', requireMcpToken, (req, res) => res.status(405).json(error(null, INVALID_REQUEST, 'Method Not Allowed')));
router.get('/:token', requireMcpToken, (req, res) => res.status(405).json(error(null, INVALID_REQUEST, 'Method Not Allowed')));

// Session teardown — nothing is held server-side, so acknowledge and move on.
router.delete('/', requireMcpToken, (req, res) => res.status(204).end());
router.delete('/:token', requireMcpToken, (req, res) => res.status(204).end());

router.use(onFailure);

module.exports = router;
