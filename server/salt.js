'use strict';

/**
 * Salt — a signed human receipt for one agent action.
 *
 * Its own product (Stripe-shaped): any site loads js/salt.js, any agent
 * hits the API / MCP. Not a Pool Pilot surface. Hosts fail-closed until
 * verify() returns ok. The human taps a packet. No email/SMS code.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');
const hosts = require('./hosts');

const TTL_MS = Number(process.env.SALT_TTL_MS) || 90 * 1000;
const FILE = () => path.join(ensureDataDir(), 'salt.json');
const SECRET_FILE = () => path.join(ensureDataDir(), 'salt-secret');

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function publicBase() {
  return String(process.env.SALT_PUBLIC_BASE || 'https://uneedsalt.com').replace(/\/$/, '');
}

function isSaltPath(pathname) {
  const p = String(pathname || '');
  return p === '/.well-known/human-receipt' || p === '/api/salt' || p.indexOf('/api/salt/') === 0;
}

/** Open CORS — other sites must call Salt the way they call Stripe. Returns true if OPTIONS was answered. */
function writeCors(req, res) {
  const origin = (req.headers && req.headers.origin) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Salt-Key, X-Salt-Issue');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    if (typeof res.end === 'function') res.end();
    return true;
  }
  return false;
}

const _hits = new Map();
function rateHit(ip) {
  if (!ip) return;
  const t = now();
  let b = _hits.get(ip) || [];
  b = b.filter((x) => t - x < 60000);
  if (b.length >= 40) throw err(429, 'Slow down.');
  b.push(t);
  _hits.set(ip, b);
}

function secret() {
  if (process.env.SALT_SECRET && String(process.env.SALT_SECRET).length >= 16) {
    return String(process.env.SALT_SECRET);
  }
  try {
    if (fs.existsSync(SECRET_FILE())) {
      const s = fs.readFileSync(SECRET_FILE(), 'utf8').trim();
      if (s.length >= 16) return s;
    }
  } catch (e) { /* ignore */ }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    ensureDataDir();
    fs.writeFileSync(SECRET_FILE(), s, { encoding: 'utf8', mode: 0o600 });
  } catch (e) { /* /tmp or read-only — in-memory secret this process only */ }
  return s;
}

function nid() {
  return crypto.randomBytes(16).toString('base64url');
}

function now() { return Date.now(); }

function load() {
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && j.challenges && typeof j.challenges === 'object') return j;
  } catch (e) { /* missing or bad file */ }
  return { challenges: {} };
}

function save(db) {
  ensureDataDir();
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE());
}

function prune(db) {
  const t = now();
  Object.keys(db.challenges).forEach(function (id) {
    const c = db.challenges[id];
    if (!c) return;
    if (c.status === 'pending' && c.expiresAt <= t) c.status = 'expired';
    // drop finished/expired after 1h so the file stays small
    if (c.expiresAt && t - c.expiresAt > 60 * 60 * 1000) delete db.challenges[id];
  });
}

function tapUrl(id) {
  return publicBase() + '/?c=' + encodeURIComponent(id);
}

function wellKnown() {
  const base = publicBase();
  return {
    ok: true,
    name: 'Salt',
    verb: 'human_receipt',
    human_required: 403,
    challenge: 'POST ' + base + '/api/salt/challenge',
    poll: 'GET ' + base + '/api/salt/challenge/{id}',
    yes: 'POST ' + base + '/api/salt/challenge/{id}/yes',
    no: 'POST ' + base + '/api/salt/challenge/{id}/no',
    verify: 'POST ' + base + '/api/salt/verify',
    tap: base + '/?c={id}',
    js: base + '/js/salt.js',
    css: base + '/css/salt.css',
    docs: base + '/salt.txt',
    mcp: 'POST ' + base + '/api/salt/mcp',
    host: base + '/host',
    packs: hosts.publicPacks(),
    auth: 'Authorization: Bearer sk_live_…',
    ttl_ms: TTL_MS,
    note: 'Salt is its own product on uneedsalt.com. Agents act without asking; hosts eat the bill. A live receipt is a signed yes they cannot fake. Fail closed. Demo receipts are not live. Human never pays. Host prepaid yeses at /host.',
  };
}

function publicChallenge(c) {
  if (!c) return null;
  const t = now();
  const status = (c.status === 'pending' && c.expiresAt <= t) ? 'expired' : c.status;
  return {
    ok: true,
    id: c.id,
    who: c.who,
    action: c.action,
    to: c.to,
    amount: c.amount,
    unit: c.unit,
    status: status,
    tap: tapUrl(c.id),
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    live: c.live === true,
    receipt: status === 'yes' ? c.receipt : null,
  };
}

function signReceipt(payload) {
  const body = JSON.stringify({
    v: 1,
    id: payload.id,
    who: payload.who,
    action: payload.action,
    to: payload.to,
    amount: payload.amount,
    unit: payload.unit || '',
    ok: true,
    at: payload.at,
    exp: payload.exp,
    live: payload.live === true,
  });
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return Object.assign({ v: 1 }, payload, { ok: true, live: payload.live === true, sig: sig });
}

function verifyReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return { ok: false, error: 'No receipt.' };
  if (!receipt.ok || !receipt.sig || !receipt.id) return { ok: false, error: 'Receipt incomplete.' };
  if (Number(receipt.exp) && Number(receipt.exp) < now()) return { ok: false, error: 'Receipt expired.', id: receipt.id };
  const expect = signReceipt({
    id: receipt.id,
    who: receipt.who,
    action: receipt.action,
    to: receipt.to,
    amount: receipt.amount,
    unit: receipt.unit || '',
    at: receipt.at,
    exp: receipt.exp,
    live: receipt.live === true,
  });
  const a = Buffer.from(String(receipt.sig));
  const b = Buffer.from(String(expect.sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Receipt not signed by Salt.' };
  }
  return { ok: true, live: expect.live === true, receipt: expect };
}

function clean(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max || 80);
}

async function create(input, meta) {
  rateHit(meta && meta.ip);
  const who = clean(input && input.who, 64) || 'agent';
  const action = clean(input && (input.action || input.do), 32) || 'act';
  const to = clean(input && input.to, 120);
  const amount = input && input.amount != null && input.amount !== '' ? clean(input.amount, 32) : '';
  const unit = clean(input && input.unit, 16);
  if (!to && !amount) throw err(400, 'Say what the agent wants (to / amount).');
  const host = await hosts.resolve(meta);
  if (host && !hosts.canCreate(host)) {
    throw err(402, 'Host unpaid. Buy yeses at ' + hosts.publicBase() + '/host');
  }
  if (!host && process.env.SALT_REQUIRE_HOST === '1') {
    throw err(401, 'Need a host key. ' + hosts.publicBase() + '/host');
  }
  const db = load();
  prune(db);
  const id = nid();
  const createdAt = now();
  const c = {
    id: id,
    who: who,
    action: action,
    to: to,
    amount: amount,
    unit: unit,
    status: 'pending',
    createdAt: createdAt,
    expiresAt: createdAt + TTL_MS,
    receipt: null,
    hostId: host ? host.id : '',
    live: !!(host && hosts.canCreate(host)),
  };
  db.challenges[id] = c;
  save(db);
  return publicChallenge(c);
}

function get(id) {
  const db = load();
  prune(db);
  const c = db.challenges[String(id || '')];
  if (!c) throw err(404, 'No such challenge.');
  if (c.status === 'pending' && c.expiresAt <= now()) {
    c.status = 'expired';
    save(db);
  }
  return publicChallenge(c);
}

async function decide(id, yes) {
  const db = load();
  prune(db);
  const c = db.challenges[String(id || '')];
  if (!c) throw err(404, 'No such challenge.');
  if (c.status === 'pending' && c.expiresAt <= now()) {
    c.status = 'expired';
    save(db);
  }
  if (c.status === 'expired') throw err(410, 'Too late — ask the agent to knock again.');
  if (c.status !== 'pending') return publicChallenge(c);
  c.status = yes ? 'yes' : 'no';
  if (yes) {
    const at = now();
    if (c.hostId && c.live) await hosts.burn(c.hostId);
    c.receipt = signReceipt({
      id: c.id,
      who: c.who,
      action: c.action,
      to: c.to,
      amount: c.amount,
      unit: c.unit || '',
      at: at,
      exp: at + 10 * 60 * 1000,
      live: c.live === true,
    });
  }
  save(db);
  return publicChallenge(c);
}

function humanRequired(detail) {
  return {
    ok: false,
    error: 'Human Required',
    human_required: 403,
    salt: wellKnown(),
    challenge: detail || null,
  };
}

function mcpTools() {
  return [
    {
      name: 'salt_challenge',
      description: 'Ask a human for a Salt yes before paying, sending, posting, or ringing. Send key (host key from uneedsalt.com/host) so the receipt is live. Demo receipts (no key) must not authorize a real action. Fail closed until salt_verify returns live true.',
      inputSchema: {
        type: 'object',
        properties: {
          who: { type: 'string', description: 'Your product name' },
          action: { type: 'string', description: 'pay | send | post | ring' },
          to: { type: 'string' },
          amount: { type: 'string' },
          unit: { type: 'string' },
          key: { type: 'string', description: 'Host key sk_live_… or sk_test_… from https://uneedsalt.com/host' },
        },
      },
    },
    {
      name: 'salt_poll',
      description: 'Poll a Salt challenge until yes, no, or expired.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    {
      name: 'salt_verify',
      description: 'Verify a Salt receipt. If ok is false OR live is not true, do not perform the action. Demo receipts are not live.',
      inputSchema: { type: 'object', properties: { receipt: { type: 'object' } }, required: ['receipt'] },
    },
  ];
}

async function handleMcp(body, meta) {
  const id = body && body.id != null ? body.id : 1;
  const method = body && body.method;
  function ok(result) { return { status: 200, json: { jsonrpc: '2.0', id: id, result: result } }; }
  function fail(code, message) { return { status: 200, json: { jsonrpc: '2.0', id: id, error: { code: code, message: message } } }; }
  if (method === 'initialize') {
    return ok({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'salt', version: '1.1.0' },
    });
  }
  if (method === 'tools/list' || method === 'tools/listChanged') {
    return ok({ tools: mcpTools() });
  }
  if (method === 'tools/call') {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};
    function text(obj) {
      return ok({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
    }
    try {
      if (name === 'salt_challenge') {
        const ch = await create(args, Object.assign({}, meta, { key: args.key || args.host_key }));
        return text(Object.assign({ human_required: 403 }, ch));
      }
      if (name === 'salt_poll') return text(get(args.id));
      if (name === 'salt_verify') return text(verifyReceipt(args.receipt || args));
      return fail(-32601, 'Unknown tool');
    } catch (e) {
      return text({ ok: false, error: e.message, status: e.status || 500 });
    }
  }
  if (method === 'ping') return ok({});
  return fail(-32601, 'Unknown method');
}

function mountRoutes(app) {
  function fail(res, e) {
    res.status((e && e.status) || 500).json({ ok: false, error: (e && e.message) || 'error' });
  }

  app.get(['/.well-known/human-receipt', '/api/salt', '/api/salt/well-known'], function (_req, res) {
    res.set('Cache-Control', 'no-store');
    res.json(wellKnown());
  });

  app.get('/api/salt/host/packs', function (_req, res) {
    res.json({ ok: true, packs: hosts.publicPacks(), stripe: require('./stripe').stripeOn(), host: hosts.publicBase() + '/host' });
  });

  app.post('/api/salt/host/checkout', async function (req, res) {
    try {
      const out = await hosts.checkout(req.body || {});
      res.status(out.status).json(out.json);
    } catch (e) { fail(res, e); }
  });

  app.get('/api/salt/host/session/:id', async function (req, res) {
    try { res.json(await hosts.sessionReturn(req.params.id)); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/salt/host/me', async function (req, res) {
    try { res.json(await hosts.me({ headers: req.headers, ip: req.ip })); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/salt/host/issue', function (req, res) {
    try { res.status(201).json(hosts.adminIssue(req.body || {}, { headers: req.headers })); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/salt/challenge', async function (req, res) {
    try {
      const c = await create(req.body || {}, {
        ip: req.ip || (req.headers && req.headers['x-forwarded-for']),
        headers: req.headers,
        key: req.body && (req.body.key || req.body.host_key),
      });
      res.status(201).json(Object.assign({ human_required: 403 }, c));
    } catch (e) { fail(res, e); }
  });

  app.post('/api/salt/mcp', async function (req, res) {
    const out = await handleMcp(req.body || {}, { ip: req.ip, headers: req.headers });
    res.status(out.status).json(out.json);
  });

  app.get('/api/salt/challenge/:id', function (req, res) {
    try { res.json(get(req.params.id)); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/salt/challenge/:id/yes', async function (req, res) {
    try { res.json(await decide(req.params.id, true)); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/salt/challenge/:id/no', async function (req, res) {
    try { res.json(await decide(req.params.id, false)); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/salt/verify', function (req, res) {
    const body = req.body || {};
    const out = verifyReceipt(body.receipt || body);
    res.status(out.ok ? 200 : 403).json(out);
  });
}

/** Used by the Vercel handler (no Express). */
async function handleHttp(method, pathname, body, meta) {
  if (method === 'GET' && (pathname === '/.well-known/human-receipt' || pathname === '/api/salt' || pathname === '/api/salt/well-known')) {
    return { status: 200, json: wellKnown() };
  }
  if (method === 'GET' && pathname === '/api/salt/host/packs') {
    return { status: 200, json: { ok: true, packs: hosts.publicPacks(), stripe: require('./stripe').stripeOn(), host: hosts.publicBase() + '/host' } };
  }
  if (method === 'POST' && pathname === '/api/salt/host/checkout') {
    return hosts.checkout(body || {});
  }
  if (method === 'GET' && pathname.indexOf('/api/salt/host/session/') === 0) {
    const sid = decodeURIComponent(pathname.slice('/api/salt/host/session/'.length));
    return { status: 200, json: await hosts.sessionReturn(sid) };
  }
  if (method === 'GET' && pathname === '/api/salt/host/me') {
    return { status: 200, json: await hosts.me(meta || {}) };
  }
  if (method === 'POST' && pathname === '/api/salt/host/issue') {
    return { status: 201, json: hosts.adminIssue(body || {}, meta || {}) };
  }
  if (method === 'POST' && pathname === '/api/salt/mcp') {
    return handleMcp(body || {}, meta);
  }
  if (method === 'POST' && pathname === '/api/salt/challenge') {
    const c = await create(body || {}, Object.assign({}, meta, { key: body && (body.key || body.host_key) }));
    return { status: 201, json: Object.assign({ human_required: 403 }, c) };
  }
  const m = String(pathname || '').match(/^\/api\/salt\/challenge\/([^/]+)(?:\/(yes|no))?$/);
  if (m && method === 'GET' && !m[2]) return { status: 200, json: get(decodeURIComponent(m[1])) };
  if (m && method === 'POST' && m[2] === 'yes') return { status: 200, json: await decide(decodeURIComponent(m[1]), true) };
  if (m && method === 'POST' && m[2] === 'no') return { status: 200, json: await decide(decodeURIComponent(m[1]), false) };
  if (method === 'POST' && pathname === '/api/salt/verify') {
    const out = verifyReceipt((body && body.receipt) || body);
    return { status: out.ok ? 200 : 403, json: out };
  }
  return null;
}

module.exports = {
  TTL_MS,
  wellKnown,
  publicBase,
  isSaltPath,
  writeCors,
  tapUrl,
  create,
  get,
  decide,
  verifyReceipt,
  signReceipt,
  humanRequired,
  handleMcp,
  mountRoutes,
  handleHttp,
};
