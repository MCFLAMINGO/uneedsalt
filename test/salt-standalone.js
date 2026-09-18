'use strict';
/**
 * Salt must work like Stripe: any origin, own script, own MCP — not a desk page.
 */
const salt = require('../server/salt');
const fs = require('fs');
const path = require('path');

function ok(name, cond) { if (!cond) throw new Error('FAIL ' + name); console.log('ok', name); }
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

async function main() {
  ok('isSaltPath', salt.isSaltPath('/api/salt/challenge') && salt.isSaltPath('/.well-known/human-receipt'));
  ok('not desk path', !salt.isSaltPath('/api/slwurld/config') && !salt.isSaltPath('/seat'));

  const headers = {};
  const res = {
    statusCode: 200,
    setHeader: function (k, v) { headers[k] = v; },
    end: function () { this.ended = true; },
  };
  ok('OPTIONS from a foreign shop is allowed',
    salt.writeCors({ method: 'OPTIONS', headers: { origin: 'https://shop.example' } }, res) === true
    && headers['Access-Control-Allow-Origin'] === 'https://shop.example'
    && /Authorization/.test(headers['Access-Control-Allow-Headers'])
    && res.ended === true);

  const listed = await salt.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  ok('mcp lists challenge', listed.json.result.tools.some(function (t) { return t.name === 'salt_challenge'; }));

  const ch = await salt.handleMcp({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'salt_challenge', arguments: { who: 'shop.example', action: 'pay', to: 'vendor', amount: '12' } },
  });
  const payload = JSON.parse(ch.json.result.content[0].text);
  ok('mcp challenge is a receipt door', payload.human_required === 403 && payload.status === 'pending' && payload.tap);
  ok('mcp without key is demo', payload.live === false);

  const js = read('js/salt.js');
  ok('js always hits uneedsalt.com, not the embedder', /return 'https:\/\/uneedsalt\.com'/.test(js) && !/POOL_PILOT_API/.test(js));
  ok('assets never use the embedder origin', /127\.0\.0\.1:3000/.test(js) && !/return w\.location\.origin/.test(js));
  ok('js sends host key', /Authorization/.test(js) && /SALT_KEY/.test(js));
  const docs = read('salt.txt');
  ok('docs are their own product', /its own product/.test(docs) && /uneedsalt\.com/.test(docs));
  ok('docs do not deep-link cooks into the desk', !/poolpilot\.xyz\/(seat|sit|slwurld|swap|arrive)/i.test(docs));
  ok('docs sell the host not the thumb', /human never pays/i.test(docs) && /\/host/.test(docs) && /live/.test(docs));
  ok('landing is a product, not a desk', /Human receipts for/.test(read('index.html')) && /uneedsalt\.com\/js\/salt\.js/.test(read('index.html')) && !/slwurld/i.test(read('index.html')));
  ok('landing sells keys', /Get a key/.test(read('index.html')) && /\/host/.test(read('index.html')));
  ok('public base is uneedsalt.com', !process.env.SALT_PUBLIC_BASE && salt.publicBase() === 'https://uneedsalt.com');
  ok('vercel parks uneedsalt.com on Salt', /uneedsalt\.com/.test(read('vercel.json')));
  ok('llms.txt points agents at the till', /uneedsalt\.com\/host/.test(read('llms.txt')));
  ok('mcp registry file', /api\/salt\/mcp/.test(read('mcp.json')));
  ok('openai actions file', /saltChallenge/.test(read('openapi.yaml')));

  console.log('salt-standalone: all ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
