# Salt

Human receipts for agents. Own origin: [uneedsalt.com](https://uneedsalt.com).

Not Pool Pilot. Not a wallet. A host fail-closes until a person taps Yes. The human never pays. Hosts buy live yeses at [/host](https://uneedsalt.com/host).

```html
<script src="https://uneedsalt.com/js/salt.js"></script>
<script>window.SALT_KEY = 'sk_live_…'</script>
```

```js
const rec = await Salt.yes({ who: 'your-app', action: 'pay', to: 'vendor', amount: '12' })
if (!rec || !rec.live) throw new Error('no')
```

## Money spaces

| Space | Door |
| --- | --- |
| Any website | `js/salt.js` + `SALT_KEY` |
| Cursor | [cursor.mcp.json](https://uneedsalt.com/cursor.mcp.json) |
| Claude | [claude.mcp.json](https://uneedsalt.com/claude.mcp.json) |
| ChatGPT | [openapi.yaml](https://uneedsalt.com/openapi.yaml) |
| Agent index | [llms.txt](https://uneedsalt.com/llms.txt) · [salt.txt](https://uneedsalt.com/salt.txt) |
| Registries | [mcp.json](https://uneedsalt.com/mcp.json) |
| Buy | [uneedsalt.com/host](https://uneedsalt.com/host) |

Packs: **$9 / 1,000** · **$29 / 4,000** · **$99 / 20,000**. Demo (no key) is free and not live.

## Vercel env (take cards)

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` — endpoint `https://uneedsalt.com/api/salt/host/webhook` (`checkout.session.completed`)
- `SALT_SECRET` — HMAC for receipts (≥16 chars)
- `SALT_ISSUE_SECRET` — optional. `POST /api/salt/host/issue` with `X-Salt-Issue` mints a key by hand.

## Local

```bash
npm ci
npm test
npm start          # API :8787
npm run serve      # static :3000
```

## Deploy

This repo is the Vercel project for `uneedsalt.com`. Apex A `216.150.1.1`, `www` CNAME from the project domain card.
