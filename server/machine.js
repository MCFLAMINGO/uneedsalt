'use strict';

/**
 * Agents pay here. One live knock is 0.50 USD (Stripe card minimum).
 * Demo without payment stays free and live: false. The human never pays.
 */
const crypto = require('crypto');
const salt = require('./salt');

const AMOUNT = '0.50';

function configured() {
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  const profile = String(process.env.STRIPE_PROFILE_ID || '');
  return key.length > 10 && profile.indexOf('profile_') === 0;
}

function mppSecret() {
  return crypto.createHmac('sha256', String(process.env.STRIPE_SECRET_KEY)).update('mpp-challenge-signing').digest('base64');
}

let ready = null;
function client() {
  if (ready) return ready;
  ready = (async function () {
    const { Mppx, stripe } = await import('mppx/server');
    const Stripe = require('stripe');
    const key = String(process.env.STRIPE_SECRET_KEY);
    const stripeClient = new Stripe(key);
    const tempo = String(process.env.TEMPO_DEPOSIT_ADDRESS || '');
    const payments = stripe.create({
      client: stripeClient,
      networkId: String(process.env.STRIPE_PROFILE_ID),
      livemode: key.indexOf('_test_') === -1,
      depositAddresses: tempo ? { tempo: tempo } : undefined,
    });
    const methods = await payments.defaultMethods(tempo ? undefined : { exclude: ['tempo'] });
    return Mppx.create({
      methods: methods,
      secretKey: mppSecret(),
      realm: 'uneedsalt.com',
      requiresAuth: true,
    });
  })();
  return ready;
}

function readRaw(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(JSON.stringify(req.body));
  }
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > 64 * 1024) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function fetchRequest(req, raw) {
  const headersIn = req.headers || {};
  const host = headersIn['x-forwarded-host'] || headersIn.host || 'uneedsalt.com';
  const proto = headersIn['x-forwarded-proto'] || 'https';
  const headers = new Headers();
  Object.keys(headersIn).forEach(function (k) {
    if (k.toLowerCase() === 'content-length') return;
    const v = headersIn[k];
    if (v == null) return;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  });
  const method = req.method || 'POST';
  const init = { method: method, headers: headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = raw || '';
  return new Request(proto + '://' + host + (req.url || '/api/salt/live'), init);
}

function ipOf(req) {
  const xf = req.headers && req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || '';
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

async function sendFetch(res, response) {
  const { NodeListener } = await import('mppx/server');
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate');
  headers.set('Cache-Control', 'no-store');
  const wrapped = new Response(await response.arrayBuffer(), { status: response.status, headers: headers });
  await NodeListener.sendResponse(res, wrapped);
}

async function handle(req, res) {
  if (!configured()) {
    return sendJson(res, 503, {
      ok: false,
      error: 'Agent pay needs STRIPE_SECRET_KEY and STRIPE_PROFILE_ID on the uneedsalt Vercel project. Claim a Stripe profile, then set STRIPE_PROFILE_ID.',
      amount: AMOUNT,
      currency: 'usd',
      endpoint: salt.publicBase() + '/api/salt/live',
      host: salt.publicBase() + '/host',
      note: 'Until machine pay is on, hosts buy packs at /host. The human never pays.',
    });
  }
  const raw = await readRaw(req);
  const pay = await client();
  const result = await pay.charge({
    amount: AMOUNT,
    description: 'Salt live yes. Agent pays. The human does not.',
  })(fetchRequest(req, raw));
  if (result.status === 402) return sendFetch(res, result.challenge);
  let body = {};
  if (raw) {
    try { body = JSON.parse(raw); }
    catch (e) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON' }); }
  }
  const created = await salt.create(body || {}, {
    machinePaid: true,
    ip: ipOf(req),
    headers: req.headers,
  });
  const payload = Object.assign({ human_required: 403, paid: AMOUNT, currency: 'usd' }, created);
  return sendFetch(res, result.withReceipt(Response.json(payload, { status: 201 })));
}

module.exports = { handle, configured, AMOUNT };
