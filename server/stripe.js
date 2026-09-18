'use strict';

const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

function stripeOn() {
  return !!(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).length > 10);
}

function request(method, pathname, params) {
  if (!stripeOn()) return Promise.reject(new Error('Stripe is off.'));
  const body = params ? querystring.stringify(params) : '';
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: pathname,
      method: method,
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(raw); } catch (e) {
          reject(new Error('Stripe sent non-JSON'));
          return;
        }
        if (json && json.error) {
          const err = new Error(json.error.message || 'Stripe error');
          err.status = 402;
          reject(err);
          return;
        }
        resolve(json);
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function verifyWebhook(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw Object.assign(new Error('No webhook secret.'), { status: 503 });
  const parts = String(header || '').split(',').map(function (p) { return p.trim(); });
  let t = '';
  const v1 = [];
  parts.forEach(function (p) {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i);
    const v = p.slice(i + 1);
    if (k === 't') t = v;
    if (k === 'v1') v1.push(v);
  });
  if (!t || !v1.length) throw Object.assign(new Error('Bad Stripe signature.'), { status: 400 });
  const signed = t + '.' + String(raw);
  const expect = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const ok = v1.some(function (got) {
    const a = Buffer.from(expect);
    const b = Buffer.from(got);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw Object.assign(new Error('Stripe signature mismatch.'), { status: 400 });
  return JSON.parse(String(raw));
}

module.exports = { stripeOn, request, verifyWebhook };
