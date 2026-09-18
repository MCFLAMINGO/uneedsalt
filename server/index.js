'use strict';

const express = require('express');
const path = require('path');
const salt = require('./salt');
const hosts = require('./hosts');

const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const app = express();
app.disable('x-powered-by');

app.post('/api/salt/host/webhook', express.raw({ type: '*/*' }), function (req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  hosts.handleWebhook(raw, req.headers['stripe-signature']).then(function (out) {
    res.status(out.status).json(out.json);
  }).catch(function (e) {
    res.status((e && e.status) || 400).json({ ok: false, error: (e && e.message) || 'webhook error' });
  });
});

app.use(express.json({ limit: '64kb' }));

app.use(function (req, res, next) {
  if (salt.isSaltPath(req.path)) {
    if (salt.writeCors(req, res)) return;
  }
  next();
});

salt.mountRoutes(app);

const root = path.join(__dirname, '..');
app.get(['/host', '/host.html'], function (_req, res) {
  res.sendFile(path.join(root, 'host.html'));
});
app.use(express.static(root));

app.listen(port, '0.0.0.0', function () {
  console.log('Salt on :' + port);
});
