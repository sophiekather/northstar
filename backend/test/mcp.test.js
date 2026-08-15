require('dotenv').config();

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// The token has to be in place before routes/mcp.js reads it on the first
// request. Tests run against a throwaway value, never the deployed one.
const TOKEN = 'test-mcp-token-do-not-deploy';
process.env.MCP_TOKEN = TOKEN;

const mcpRoutes = require('../src/routes/mcp');
const { toolNames, prisma } = require('../src/services/mcpTools');

// Mounted the same way src/index.js mounts it: before any body parser or auth.
const app = express();
app.use('/api/mcp', mcpRoutes);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/mcp`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

/** POST a JSON-RPC message with the token in the path, as Claude does. */
function rpc(message, { token = TOKEN } = {}) {
  return fetch(`${baseUrl}/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
}

let nextId = 1;
const call = (method, params) => rpc({ jsonrpc: '2.0', id: nextId++, method, params });

/** Unwraps the JSON payload a tool result carries in its text block. */
function toolPayload(body) {
  assert.ok(body.result, `expected a result, got ${JSON.stringify(body)}`);
  return JSON.parse(body.result.content[0].text);
}

test('a bad token is rejected with 401', async (t) => {
  await t.test('wrong token in the path', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: 'nope' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Unauthorized' });
  });

  await t.test('wrong bearer token', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('no token at all', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('a token of the right length but wrong value', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: 'x'.repeat(TOKEN.length) });
    assert.equal(res.status, 401);
  });
});

test('the correct token is accepted as a bearer header', async () => {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
});

test('initialize reports the protocol version', async () => {
  const body = await (await call('initialize', {})).json();
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.equal(body.result.serverInfo.name, 'northstar');
  assert.ok(body.result.capabilities.tools);
});

test('tools/list returns every tool with a usable schema', async () => {
  const res = await call('tools/list');
  assert.equal(res.status, 200);
  const { result } = await res.json();

  assert.deepEqual(
    result.tools.map((t) => t.name).sort(),
    [...toolNames].sort(),
    'tools/list must expose the whole catalogue'
  );

  for (const tool of result.tools) {
    assert.ok(tool.description, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} needs an object schema`);
  }

  // Guards the fields corrected against the real Prisma models — a regression
  // here means the schemas have drifted back to the reference implementation's
  // snake_case guesses.
  const createTask = result.tools.find((t) => t.name === 'create_task');
  assert.deepEqual(createTask.inputSchema.required, ['projectId', 'title']);
  assert.ok(createTask.inputSchema.properties.dueDate, 'due date is dueDate, not due_date');
  assert.ok(!createTask.inputSchema.properties.due_date);

  const createEntry = result.tools.find((t) => t.name === 'create_time_entry');
  assert.deepEqual(createEntry.inputSchema.required, ['projectId', 'taskTypeId', 'date', 'hours']);
});

test('tools/call on a read tool returns real data', async (t) => {
  await t.test('list_clients returns rows from the database', async () => {
    const res = await call('tools/call', { name: 'list_clients', arguments: {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.isError, false);

    const clients = toolPayload(body);
    assert.ok(Array.isArray(clients));
    assert.ok(clients.length > 0, 'expected the dev database to hold at least one client');
    for (const c of clients) {
      assert.equal(typeof c.id, 'string');
      assert.equal(typeof c.name, 'string');
      assert.equal(c.isActive, true, 'archived clients are excluded by default');
    }

    const expected = await prisma.client.count({ where: { isActive: true } });
    assert.equal(clients.length, expected, 'every active client should come back');
  });

  await t.test('list_tasks joins through to project and client names', async () => {
    const tasks = toolPayload(await (await call('tools/call', { name: 'list_tasks', arguments: {} })).json());
    assert.ok(Array.isArray(tasks));
    for (const task of tasks) {
      assert.notEqual(task.status, 'DONE', 'open tasks only by default');
      assert.equal(typeof task.projectName, 'string');
      assert.equal(typeof task.loggedHours, 'number');
    }
  });

  await t.test('list_time_entries covers the whole team, not one session user', async () => {
    const entries = toolPayload(
      await (await call('tools/call', { name: 'list_time_entries', arguments: { limit: 5 } })).json()
    );
    assert.ok(entries.length <= 5);
    for (const e of entries) {
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, 'dates are returned as plain calendar days');
      assert.equal(typeof e.userName, 'string');
    }
  });
});

test('a failing tool comes back as a result with isError, not a JSON-RPC error', async (t) => {
  await t.test('unknown tool', async () => {
    const body = await (await call('tools/call', { name: 'no_such_tool', arguments: {} })).json();
    assert.equal(body.error, undefined, 'must not be a JSON-RPC error');
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /Unknown tool/);
  });

  await t.test('a bad argument explains itself', async () => {
    const body = await (
      await call('tools/call', { name: 'create_task', arguments: { projectId: 'nope', title: 'x' } })
    ).json();
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /No project with id nope/);
  });
});

test('unknown methods are a JSON-RPC error', async () => {
  const body = await (await call('resources/read', { uri: 'x' })).json();
  assert.equal(body.result, undefined);
  assert.equal(body.error.code, -32601);
});

test('resources/list and prompts/list are empty but present', async () => {
  assert.deepEqual((await (await call('resources/list')).json()).result, { resources: [] });
  assert.deepEqual((await (await call('prompts/list')).json()).result, { prompts: [] });
});

test('notifications get 202 with no body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), '');
});

test('batches are handled, and notifications inside them stay silent', async (t) => {
  await t.test('mixed batch answers only the requests', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
    ]);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 2);
    assert.deepEqual(body.map((r) => r.id), ['a', 'b']);
  });

  await t.test('an all-notification batch gets 202', async () => {
    const res = await rpc([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled' },
    ]);
    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  });
});

test('GET is 405 and DELETE is 204', async (t) => {
  await t.test('GET', async () => {
    const res = await fetch(`${baseUrl}/${TOKEN}`);
    assert.equal(res.status, 405);
  });

  await t.test('DELETE', async () => {
    const res = await fetch(`${baseUrl}/${TOKEN}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });
});

test('the health route lists the tools', async () => {
  const res = await fetch(`${baseUrl}/${TOKEN}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.tools.sort(), [...toolNames].sort());
});

test('health is unreachable with a bad token', async () => {
  const res = await fetch(`${baseUrl}/wrong/health`);
  assert.equal(res.status, 401);
});

test('malformed JSON is a parse error, not an HTML 400', async () => {
  const res = await fetch(`${baseUrl}/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32700);
});
