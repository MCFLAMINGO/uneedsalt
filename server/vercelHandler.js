'use strict';

const salt = require('./salt');
const hosts = require('./hosts');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readRaw(req, maxBytes) {
  const limit = maxBytes || 64 * 1024;
  return new Promise(function (resolve, reject) {
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    if (typeof req.body === 'string') return resolve(req.body);
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) {
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

function readBody(req, maxBytes) {
  const limit = maxBytes || 64 * 1024;
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function ipOf(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
}

function pathnameOf(req) {
  const raw = req.url || '/';
  let pathname = '/';
  let hinted = '';
  try {
    const u = new URL(raw, 'http://local');
    pathname = u.pathname || '/';
    hinted = u.searchParams.get('__salt') || '';
  } catch (e) {
    pathname = String(raw).split('?')[0] || '/';
  }
  // Vercel's api/[...path] only matches one segment. Nested /api/* is rewritten
  // to /api?__salt=… and the original path is rebuilt here. A preserved req.url
  // (already /api/salt/…) wins, so the hint cannot override a real route.
  if ((pathname === '/api' || pathname === '/api/') && hinted) {
    return '/api/' + String(hinted).replace(/^\/+/, '');
  }
  return pathname;
}

async function handler(req, res) {
  const pathname = pathnameOf(req);
  if (salt.isSaltPath(pathname) && salt.writeCors(req, res)) return;
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    return send(res, 200, { ok: true, service: 'salt', ts: Date.now() });
  }
  if (pathname === '/api/salt/host/webhook' && req.method === 'POST') {
    try {
      const raw = await readRaw(req);
      const out = await hosts.handleWebhook(raw, req.headers['stripe-signature']);
      return send(res, out.status, out.json);
    } catch (e) {
      return send(res, e.status || 400, { ok: false, error: String(e && e.message) || 'webhook error' });
    }
  }
  if (pathname === '/.well-known/human-receipt' || pathname === '/api/salt' || pathname.indexOf('/api/salt/') === 0) {
    try {
      const body = req.method === 'GET' ? null : await readBody(req);
      const out = await salt.handleHttp(req.method, pathname, body, {
        ip: ipOf(req),
        headers: req.headers,
        auth: req.headers && (req.headers.authorization || req.headers.Authorization),
      });
      if (out) return send(res, out.status, out.json);
      return send(res, 404, { ok: false, error: 'Not found' });
    } catch (e) {
      return send(res, e.status || 500, { ok: false, error: String(e && e.message) || 'salt error' });
    }
  }
  return send(res, 404, { ok: false, error: 'Not found', path: pathname });
}

module.exports = handler;
