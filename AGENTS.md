# Salt — uneedsalt.com

Own product. Own git. Not a Pool Pilot surface.

- Drop-in: `https://uneedsalt.com/js/salt.js` (always talks to this origin)
- Host key: `window.SALT_KEY` or `Authorization: Bearer sk_…`
- Live receipt: `verify` returns `{ ok: true, live: true }` — otherwise do not act
- Buy: `/host` prepaid packs. Human never pays.
- API: `/api/salt/challenge` · poll · yes/no · verify
- MCP: `POST /api/salt/mcp`
- Docs: `salt.txt` · `llms.txt` · `/.well-known/human-receipt`
- UI: Link-style chip → sheet → Yes

```bash
npm ci
npm test
npm start
npm run serve
```

Do not send cooks to seats, swap, or SL WURLD. Do not require MCFL to tap. Do not tax the human thumb.
