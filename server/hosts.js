'use strict';

/**
 * Host keys + prepaid yeses. The human never pays.
 * File cache + Stripe Customer metadata so Vercel cold starts still have the ledger.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./dataPath');
const stripe = require('./stripe');

const FILE = () => path.join(ensureDataDir(), 'hosts.json');

const PACKS = {
  start: { id: 'start', name: 'Start', usd: 900, yes: 1000, blurb: '$9 · 1,000 live yeses' },
  desk: { id: 'desk', name: 'Desk', usd: 2900, yes: 4000, blurb: '$29 · 4,000 live yeses' },
  floor: { id: 'floor', name: 'Floor', usd: 9900, yes: 20000, blurb: '$99 · 20,000 live yeses' },
};

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function publicBase() {
  return String(process.env.SALT_PUBLIC_BASE || 'https://uneedsalt.com').replace(/\/$/, '');
}

function publicPacks() {
  return Object.keys(PACKS).map(function (k) { return PACKS[k]; });
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (j && typeof j === 'object') {
      if (!j.hosts) j.hosts = {};
      if (!j.pending) j.pending = {};
      return j;
    }
  } catch (e) { /* missing */ }
  return { hosts: {}, pending: {} };
}

function save(db) {
  ensureDataDir();
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE());
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function extractKey(meta) {
  if (!meta) return '';
  if (meta.key) return String(meta.key).trim();
  const auth = meta.auth || (meta.headers && (meta.headers.authorization || meta.headers.Authorization));
  const s = String(auth || '').trim();
  if (/^bearer\s+/i.test(s)) return s.replace(/^bearer\s+/i, '').trim();
  return s.indexOf('sk_') === 0 ? s : '';
}

function publicHost(h, extra) {
  if (!h) return null;
  const left = Number(h.credits || 0) + Number(h.freeLeft || 0);
  return Object.assign({
    ok: true,
    id: h.id,
    hint: h.keyHint,
    email: h.email || '',
    credits: Number(h.credits || 0),
    freeLeft: Number(h.freeLeft || 0),
    left: left,
    yesCount: Number(h.yesCount || 0),
    live: left > 0,
  }, extra || {});
}

function upsertFile(host) {
  const db = load();
  db.hosts[host.id] = host;
  save(db);
  return host;
}

function findByKeyHash(keyHash) {
  const db = load();
  const ids = Object.keys(db.hosts);
  for (let i = 0; i < ids.length; i++) {
    const h = db.hosts[ids[i]];
    if (h && h.keyHash === keyHash) return h;
  }
  return null;
}

function findById(id) {
  const db = load();
  return db.hosts[id] || null;
}

async function persistStripe(host) {
  if (!stripe.stripeOn() || !host.stripeCustomerId) return host;
  try {
    await stripe.request('POST', '/v1/customers/' + host.stripeCustomerId, {
      'metadata[salt_host_id]': host.id,
      'metadata[salt_key_hash]': host.keyHash,
      'metadata[salt_credits]': String(host.credits || 0),
      'metadata[salt_free]': String(host.freeLeft || 0),
      'metadata[salt_yes]': String(host.yesCount || 0),
      'metadata[salt_hint]': host.keyHint || '',
    });
  } catch (e) { /* file remains source if Stripe blips */ }
  return host;
}

async function hydrateStripe(key) {
  if (!stripe.stripeOn()) return null;
  const m = String(key).match(/^sk_(?:live|test)_cus_([A-Za-z0-9]+)_(.+)$/);
  if (!m) return null;
  const cus = 'cus_' + m[1];
  const customer = await stripe.request('GET', '/v1/customers/' + cus, null);
  if (!customer || customer.deleted) return null;
  const md = customer.metadata || {};
  if (!md.salt_key_hash || md.salt_key_hash !== hashKey(key)) return null;
  const host = {
    id: md.salt_host_id || m[1],
    keyHash: md.salt_key_hash,
    keyHint: md.salt_hint || String(key).slice(-4),
    email: customer.email || '',
    credits: Number(md.salt_credits || 0),
    freeLeft: Number(md.salt_free || 0),
    yesCount: Number(md.salt_yes || 0),
    stripeCustomerId: cus,
    createdAt: (customer.created || 0) * 1000,
  };
  return upsertFile(host);
}

function issue(opts) {
  const o = opts || {};
  const id = (o.id || crypto.randomBytes(6).toString('hex'));
  const secret = o.secret || crypto.randomBytes(18).toString('base64url');
  const cusTail = o.stripeCustomerId ? String(o.stripeCustomerId).replace(/^cus_/, '') : '';
  const mid = cusTail ? ('cus_' + cusTail) : id;
  const prefix = stripe.stripeOn() ? 'sk_live_' : 'sk_test_';
  const key = prefix + mid + '_' + secret;
  const host = {
    id: id,
    keyHash: hashKey(key),
    keyHint: key.slice(-4),
    email: o.email || '',
    credits: Number(o.credits || 0),
    freeLeft: o.freeLeft != null ? Number(o.freeLeft) : 0,
    yesCount: 0,
    stripeCustomerId: o.stripeCustomerId || '',
    createdAt: Date.now(),
  };
  upsertFile(host);
  const db = load();
  db.pending[host.id] = { key: key, exp: Date.now() + 60 * 60 * 1000 };
  save(db);
  return { host: host, key: key };
}

function takePendingKey(hostId) {
  const db = load();
  const p = db.pending[hostId];
  if (!p) return '';
  if (p.exp && p.exp < Date.now()) {
    delete db.pending[hostId];
    save(db);
    return '';
  }
  const key = p.key;
  delete db.pending[hostId];
  save(db);
  return key;
}

async function resolve(meta) {
  const key = extractKey(meta);
  if (!key) return null;
  const hashed = hashKey(key);
  const local = findByKeyHash(hashed);
  if (local) return local;
  return hydrateStripe(key);
}

function canCreate(host) {
  if (!host) return false;
  return Number(host.credits || 0) + Number(host.freeLeft || 0) > 0;
}

async function burn(hostId) {
  const host = findById(hostId);
  if (!host) return null;
  if (Number(host.freeLeft || 0) > 0) host.freeLeft -= 1;
  else if (Number(host.credits || 0) > 0) host.credits -= 1;
  host.yesCount = Number(host.yesCount || 0) + 1;
  upsertFile(host);
  await persistStripe(host);
  return host;
}

function addCredits(host, n) {
  host.credits = Number(host.credits || 0) + Number(n || 0);
  upsertFile(host);
  return host;
}

async function checkout(input) {
  const pack = PACKS[(input && input.pack) || 'start'] || PACKS.start;
  const email = String((input && input.email) || '').trim().slice(0, 120);
  if (!stripe.stripeOn()) {
    return {
      status: 503,
      json: {
        ok: false,
        error: 'Add STRIPE_SECRET_KEY on the uneedsalt Vercel project to take cards.',
        packs: publicPacks(),
        host: publicBase() + '/host',
      },
    };
  }
  const customer = await stripe.request('POST', '/v1/customers', email ? { email: email } : {});
  const minted = issue({ email: email, credits: 0, stripeCustomerId: customer.id });
  await persistStripe(minted.host);
  const session = await stripe.request('POST', '/v1/checkout/sessions', {
    mode: 'payment',
    customer: customer.id,
    success_url: publicBase() + '/host?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: publicBase() + '/host',
    client_reference_id: minted.host.id,
    'metadata[host_id]': minted.host.id,
    'metadata[pack]': pack.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pack.usd),
    'line_items[0][price_data][product_data][name]': 'Salt ' + pack.name + ' — ' + pack.yes + ' live yeses',
    'line_items[0][price_data][product_data][description]': 'Human never pays. Host prepaid receipts.',
  });
  return { status: 200, json: { ok: true, url: session.url, pack: pack, id: minted.host.id } };
}

async function fulfillSession(session) {
  if (!session || session.payment_status && session.payment_status !== 'paid' && session.status !== 'complete') {
    if (session && session.payment_status !== 'paid') return null;
  }
  const hostId = (session.metadata && session.metadata.host_id) || session.client_reference_id;
  const packId = (session.metadata && session.metadata.pack) || 'start';
  const pack = PACKS[packId] || PACKS.start;
  if (!hostId) return null;
  const db = load();
  const host = db.hosts[hostId];
  if (!host) return null;
  const grantId = session.id || '';
  host.grants = host.grants || {};
  if (grantId && host.grants[grantId]) return host;
  if (grantId) host.grants[grantId] = { pack: pack.id, yes: pack.yes, at: Date.now() };
  addCredits(host, pack.yes);
  await persistStripe(host);
  return host;
}

async function sessionReturn(sessionId) {
  if (!sessionId) throw err(400, 'Missing session.');
  if (!stripe.stripeOn()) throw err(503, 'Stripe is off.');
  const session = await stripe.request('GET', '/v1/checkout/sessions/' + encodeURIComponent(sessionId), null);
  if (!session || (session.payment_status !== 'paid' && session.status !== 'complete')) {
    throw err(402, 'Not paid yet.');
  }
  const host = await fulfillSession(session);
  if (!host) throw err(404, 'No host for this session.');
  const key = takePendingKey(host.id);
  return publicHost(host, { key: key || undefined, paid: true, pack: (session.metadata && session.metadata.pack) || 'start' });
}

async function handleWebhook(raw, sig) {
  const ev = stripe.verifyWebhook(raw, sig);
  const type = ev && ev.type;
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    await fulfillSession(ev.data && ev.data.object);
  }
  return { status: 200, json: { ok: true } };
}

function adminIssue(input, meta) {
  const secret = process.env.SALT_ISSUE_SECRET || '';
  const got = (meta && (meta.issue || (meta.headers && (meta.headers['x-salt-issue'] || meta.headers['X-Salt-Issue'])))) || '';
  if (!secret || String(got) !== secret) throw err(403, 'No.');
  const pack = PACKS[(input && input.pack) || ''] || null;
  const credits = pack ? pack.yes : Number((input && input.credits) || 0);
  if (!credits) throw err(400, 'Say pack or credits.');
  const minted = issue({
    email: (input && input.email) || '',
    credits: credits,
  });
  persistStripe(minted.host);
  return { ok: true, key: minted.key, host: publicHost(minted.host) };
}

async function me(meta) {
  const host = await resolve(meta);
  if (!host) throw err(401, 'Need a host key.');
  return publicHost(host);
}

module.exports = {
  PACKS,
  publicPacks,
  publicBase,
  extractKey,
  hashKey,
  issue,
  resolve,
  canCreate,
  burn,
  checkout,
  sessionReturn,
  handleWebhook,
  adminIssue,
  me,
  publicHost,
  findById,
};
