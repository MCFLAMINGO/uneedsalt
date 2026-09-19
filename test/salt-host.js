'use strict';
/**
 * Host prepaid yeses. Human never pays. Demo ≠ live. 402 when unpaid.
 */
const salt = require('../server/salt');
const hosts = require('../server/hosts');

function ok(name, cond) {
  if (!cond) throw new Error('FAIL ' + name);
  console.log('ok', name);
}

process.env.SALT_SECRET = process.env.SALT_SECRET || 'test-salt-secret-32bytes-minimum';
process.env.SALT_PUBLIC_BASE = 'https://uneedsalt.com';
process.env.SALT_DATA_DIR = require('os').tmpdir() + '/salt-host-' + Date.now();
delete process.env.STRIPE_SECRET_KEY;

async function main() {
  const packs = hosts.publicPacks();
  ok('three packs', packs.length === 3 && packs[0].yes === 1000 && packs[0].usd === 900);

  const minted = hosts.issue({ credits: 2, email: 'desk@example.com' });
  ok('key shape', /^sk_test_/.test(minted.key) && minted.host.credits === 2);

  const liveCh = await salt.create(
    { who: 'shop', action: 'pay', to: 'vendor', amount: '12' },
    { key: minted.key }
  );
  ok('keyed create is live', liveCh.live === true && liveCh.status === 'pending');

  const yes = await salt.decide(liveCh.id, true);
  ok('live receipt', yes.receipt && yes.receipt.live === true);
  const v = salt.verifyReceipt(yes.receipt);
  ok('verify live', v.ok === true && v.live === true);

  const after = hosts.findById(minted.host.id);
  ok('burned one', after.credits === 1 && after.yesCount === 1);

  const yes2 = await salt.decide(
    (await salt.create({ who: 'shop', action: 'pay', to: 'vendor', amount: '4' }, { key: minted.key })).id,
    true
  );
  ok('second live yes', yes2.receipt.live === true);
  ok('empty after two', hosts.findById(minted.host.id).credits === 0);

  let unpaid = false;
  try {
    await salt.create({ who: 'shop', action: 'pay', to: 'vendor', amount: '1' }, { key: minted.key });
  } catch (e) {
    unpaid = e.status === 402 && /\/host/.test(e.message);
  }
  ok('unpaid is 402 not a human tax', unpaid);

  const demo = await salt.create({ who: 'try', action: 'pay', to: 'vendor', amount: '1' });
  ok('no key still demos', demo.live === false);
  const demoYes = await salt.decide(demo.id, true);
  ok('demo verify not live', salt.verifyReceipt(demoYes.receipt).live === false);

  process.env.SALT_ISSUE_SECRET = 'issue-me';
  const issued = hosts.adminIssue({ pack: 'start', email: 'ops@example.com' }, { issue: 'issue-me' });
  ok('admin issue start pack', issued.ok && issued.host.credits === 1000 && /^sk_test_/.test(issued.key));
  let denied = false;
  try { hosts.adminIssue({ pack: 'start' }, { issue: 'nope' }); } catch (e) { denied = e.status === 403; }
  ok('admin issue gated', denied);

  const checkout = await hosts.checkout({ pack: 'start', email: 'a@b.c' });
  ok('checkout without stripe is 503', checkout.status === 503 && checkout.json.packs.length === 3);

  const me = await hosts.me({ key: issued.key });
  ok('me shows left', me.ok && me.left === 1000);

  const mcp = await salt.handleMcp({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'salt_challenge', arguments: { who: 'cursor', action: 'pay', to: 'x', amount: '2', key: issued.key } },
  });
  const payload = JSON.parse(mcp.json.result.content[0].text);
  ok('mcp key makes live', payload.live === true);

  const httpPacks = await salt.handleHttp('GET', '/api/salt/host/packs', null, {});
  ok('http packs', httpPacks.status === 200 && httpPacks.json.ok);

  const vercel = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'vercel.json'), 'utf8'));
  const nested = (vercel.rewrites || []).some(function (r) {
    return r.source === '/api/:path*' && r.destination === '/api?__salt=:path*';
  });
  ok('vercel rewrites nested /api onto the function', nested);

  const handler = require('../server/vercelHandler');
  function hit(url) {
    return new Promise(function (resolve, reject) {
      const res = {
        statusCode: 0,
        setHeader: function () {},
        end: function (body) {
          try { resolve({ status: this.statusCode, json: JSON.parse(body) }); }
          catch (e) { reject(e); }
        },
      };
      Promise.resolve(handler({ method: 'GET', url: url, headers: {} }, res)).catch(reject);
    });
  }
  const direct = await hit('/api/salt/host/packs');
  ok('handler packs on the real path', direct.status === 200 && direct.json.ok && direct.json.packs.length === 3);
  const rewritten = await hit('/api?__salt=salt/host/packs');
  ok('handler packs after the vercel rewrite', rewritten.status === 200 && rewritten.json.packs.length === 3);
  const poll = await hit('/api?__salt=salt/challenge/abc');
  ok('handler keeps challenge ids', poll.status === 404 && poll.json && poll.json.ok === false);

  const stripe = require('../server/stripe');
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const raw = JSON.stringify({ type: 'ping' });
  const t = Math.floor(Date.now() / 1000);
  const v1 = require('crypto').createHmac('sha256', 'whsec_test').update(t + '.' + raw).digest('hex');
  const ev = stripe.verifyWebhook(raw, 't=' + t + ',v1=' + v1);
  ok('webhook hmac', ev.type === 'ping');
  let badSig = false;
  try { stripe.verifyWebhook(raw, 't=' + t + ',v1=dead'); } catch (e) { badSig = e.status === 400; }
  ok('webhook rejects junk', badSig);

  console.log('salt-host: all ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
