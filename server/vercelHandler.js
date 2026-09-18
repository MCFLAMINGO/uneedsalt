'use strict';

const salt = require('./salt');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
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
  try { return new URL(raw, 'http://local').pathname; }
  catch (e) { return String(raw).split('?')[0] || '/'; }
}

async function handler(req, res) {
  const pathname = pathnameOf(req);
  if (salt.isSaltPath(pathname) && salt.writeCors(req, res)) return;
  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
    return send(res, 200, { ok: true, service: 'salt', ts: Date.now() });
  }
  if (pathname === '/.well-known/human-receipt' || pathname === '/api/salt' || pathname.indexOf('/api/salt/') === 0) {
    try {
      const body = req.method === 'GET' ? null : await readBody(req);
      const out = salt.handleHttp(req.method, pathname, body, { ip: ipOf(req) });
      if (out) return send(res, out.status, out.json);
      return send(res, 404, { ok: false, error: 'Not found' });
    } catch (e) {
      return send(res, e.status || 500, { ok: false, error: String(e && e.message) || 'salt error' });
    }
  }
  return send(res, 404, { ok: false, error: 'Not found', path: pathname });
}

module.exports = handler;
