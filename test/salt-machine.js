'use strict';
/**
 * Agents pay 0.50 USD for one live knock. Demo stays free. Human never pays.
 */
const salt = require('../server/salt');
const machine = require('../server/machine');

function ok(name, cond) {
  if (!cond) throw new Error('FAIL ' + name);
  console.log('ok', name);
}

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PROFILE_ID;
process.env.SALT_SECRET = process.env.SALT_SECRET || 'test-salt-secret-32bytes-minimum';
process.env.SALT_DATA_DIR = require('os').tmpdir() + '/salt-machine-' + Date.now();

async function main() {
  ok('machine pay is off without stripe profile', machine.configured() === false && machine.AMOUNT === '0.50');

  const wk = salt.wellKnown();
  ok('well-known sells the machine door', /\/api\/salt\/live/.test(wk.machine) && wk.machine_usd === '0.50');

  const created = await salt.create(
    { who: 'agent', action: 'pay', to: 'vendor', amount: '12' },
    { machinePaid: true }
  );
  ok('paid knock is live without a host key', created.live === true && created.status === 'pending');
  const yes = await salt.decide(created.id, true);
  ok('machine yes receipt is live', yes.receipt && yes.receipt.live === true);

  const demo = await salt.create({ who: 'agent', action: 'pay', to: 'vendor', amount: '12' });
  ok('demo still not live', demo.live === false);

  const res = {
    statusCode: 0,
    headers: {},
    setHeader: function (k, v) { this.headers[k] = v; },
    end: function (body) { this.body = body; },
    headersSent: false,
  };
  await machine.handle({ method: 'POST', url: '/api/salt/live', headers: {}, body: { who: 'a', action: 'pay', to: 'v', amount: '1' } }, res);
  const out = JSON.parse(res.body);
  ok('unconfigured live door is 503 not a fake charge', res.statusCode === 503 && out.ok === false && out.amount === '0.50' && /STRIPE_PROFILE_ID/.test(out.error));

  console.log('salt-machine: all ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
