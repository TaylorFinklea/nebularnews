# Nebular News

Nebular News is a single‑user, self‑hosted RSS intelligence hub. It ingests feeds every hour, de‑duplicates stories, extracts main content, summarizes with your own LLM keys, and lets you chat across articles with transparent fit scoring.

## Quick start

1. Install dependencies

```
npm install
```

2. Create a D1 database and apply the schema

```
wrangler d1 create nebularnews
wrangler d1 execute nebularnews --file=./schema.sql
```

3. Configure environment variables

Create a `.dev.vars` with:

```
ADMIN_PASSWORD_HASH=pbkdf2$...
SESSION_SECRET=replace-with-long-random
ENCRYPTION_KEY=base64-32-bytes
DEFAULT_PROVIDER=openai
DEFAULT_MODEL=gpt-4o-mini
DEFAULT_REASONING_EFFORT=medium
```

Generate a password hash:

```
npm run hash-password -- "your password"
```

Generate an encryption key (32 bytes, base64):

```
node -e "const { webcrypto } = require('crypto'); console.log(Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

4. Run locally

```
wrangler dev
```

## Deployment

Update `wrangler.toml` with your D1 `database_id`. Then set secrets:

```
wrangler secret put ADMIN_PASSWORD_HASH
wrangler secret put SESSION_SECRET
wrangler secret put ENCRYPTION_KEY
```

Deploy:

```
wrangler deploy
```

## Notes

- Feed polling runs every 60 minutes via Cloudflare Cron triggers.
- API keys are stored encrypted server‑side using AES‑GCM.
- This project is licensed under AGPLv3.
