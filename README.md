# Salt

Human receipts for agents. Own origin: [uneedsalt.com](https://uneedsalt.com).

Not Pool Pilot. Not a wallet. A host fail-closes until a person taps Yes.

```html
<script src="https://uneedsalt.com/js/salt.js"></script>
```

```js
const rec = await Salt.yes({ who: 'your-app', action: 'pay', to: 'vendor', amount: '12' })
if (!rec) throw new Error('no')
```

Agents: [salt.txt](https://uneedsalt.com/salt.txt) · `GET /.well-known/human-receipt` · MCP `POST /api/salt/mcp`

## Local

```bash
npm ci
npm test
npm start          # API :8787
npm run serve      # static :3000
```

## Deploy

This repo is the Vercel project for `uneedsalt.com`. Add the domain on this project (not pool-pilot). Apex A `10.0.1.2`, `www` CNAME `cname.vercel-dns.com`.
