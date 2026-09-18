'use strict';

const express = require('express');
const path = require('path');
const salt = require('./salt');

const port = Number(process.env.PORT || process.env.API_PORT || 8787);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.use(function (req, res, next) {
  if (salt.isSaltPath(req.path)) {
    if (salt.writeCors(req, res)) return;
  }
  next();
});

salt.mountRoutes(app);

app.use(express.static(path.join(__dirname, '..')));

app.listen(port, '0.0.0.0', function () {
  console.log('Salt on :' + port);
});
