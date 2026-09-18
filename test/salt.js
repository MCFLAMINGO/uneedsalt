'use strict';
/**
 * Salt: create → poll pending → yes → signed receipt verifies.
 * Fail closed: junk / tampered / missing receipt is not ok.
 */
const salt = require('../server/salt');

function ok(name, cond) {
  if (!cond) throw new Error('FAIL ' + name);
  console.log('ok', name);
}

process.env.SALT_SECRET = process.env.SALT_SECRET || 'test-salt-secret-32bytes-minimum';
process.env.SALT_PUBLIC_BASE = 'https://uneedsalt.com';
process.env.SALT_DATA_DIR = require('os').tmpdir() + '/salt-test-' + Date.now();

const wk = salt.wellKnown();
ok('well-known name', wk.name === 'Salt' && wk.human_required === 403);
ok('well-known tap template', /\/\?c=\{id\}/.test(wk.tap));
ok('well-known js is first-party drop-in', /\/js\/salt\.js/.test(wk.js));
ok('well-known docs stand alone', /\/salt\.txt/.test(wk.docs));
ok('well-known mcp', /\/api\/salt\/mcp/.test(wk.mcp));
ok('well-known challenge', /\/api\/salt\/challenge/.test(wk.challenge));

let threw = false;
try { salt.create({}); } catch (e) { threw = e.status === 400; }
ok('create requires to or amount', threw);

const ch = salt.create({ who: 'cursor', action: 'pay', to: 'Railway', amount: '12', unit: 'USD' });
ok('create pending', ch.status === 'pending' && ch.id && ch.tap.indexOf(ch.id) !== -1);
ok('poll matches', salt.get(ch.id).status === 'pending');

const no = salt.decide(ch.id, false);
ok('no has no receipt', no.status === 'no' && !no.receipt);

const ch2 = salt.create({ who: 'slwurld', do: 'send', to: 'Sammy', amount: '36', unit: 'MCFL' });
const yes = salt.decide(ch2.id, true);
ok('yes has receipt', yes.status === 'yes' && yes.receipt && yes.receipt.sig && yes.receipt.ok === true);

const v = salt.verifyReceipt(yes.receipt);
ok('verify good receipt', v.ok === true && v.receipt.id === ch2.id);

const bad = Object.assign({}, yes.receipt, { amount: '3600' });
ok('tamper fails', salt.verifyReceipt(bad).ok === false);

ok('empty fails', salt.verifyReceipt(null).ok === false);
ok('missing fails', salt.verifyReceipt({ ok: true }).ok === false);

const httpWk = salt.handleHttp('GET', '/api/salt', null);
ok('handleHttp well-known', httpWk && httpWk.status === 200 && httpWk.json.name === 'Salt');
const http403 = salt.handleHttp('GET', '/.well-known/human-receipt', null);
ok('handleHttp well-known alias', http403 && http403.json.human_required === 403);

const httpCh = salt.handleHttp('POST', '/api/salt/challenge', { who: 'x', action: 'ring', to: 'erik' });
ok('handleHttp create', httpCh.status === 201 && httpCh.json.human_required === 403);
const id = httpCh.json.id;
ok('handleHttp poll', salt.handleHttp('GET', '/api/salt/challenge/' + id, null).json.status === 'pending');
const httpYes = salt.handleHttp('POST', '/api/salt/challenge/' + id + '/yes', {});
ok('handleHttp yes', httpYes.json.status === 'yes' && httpYes.json.receipt.sig);
const ver = salt.handleHttp('POST', '/api/salt/verify', { receipt: httpYes.json.receipt });
ok('handleHttp verify', ver.status === 200 && ver.json.ok === true);

console.log('salt: all ok');
