# Athena 🤖

A Rose-style Telegram group-management bot with an AI `/ask` command for students.
TypeScript · grammY · Vercel serverless · Upstash Redis · OpenRouter.

> **About "MissRose's source code":** Rose (@MissRose_bot) is closed-source and cannot be
> legally extracted or reverse-engineered from her servers. Her author's own open-source
> codebase (`PaulSonOfLars/tgbot`) is an archived Python app that can't run on Vercel
> serverless anyway. Athena is a **clean-room reimplementation** of Rose-style behavior —
> no copied code — designed from day one for Vercel webhooks.

## Features

- `/ask <question>` — AI answers via OpenRouter; **reply to any message with /ask** to have it answered. Per-user daily limit (admins exempt).
- Welcome & goodbye messages with fillings `{first} {last} {fullname} {username} {id} {chatname} {count}`
- Rules (`/setrules`, `/rules`)
- Warnings with configurable limit/action (`/warn`, `/warnings`, `/resetwarn`, `/warnlimit N`, `/warnaction ban|kick|mute`) + inline "remove warning" button
- Locks (`/lock photo url forward …`, `/unlock`, `/locks`) incl. `bots` auto-ban and `all`
- Purge (`/purge` as reply deletes a range, `/spurge` silent, `/del`)
- Notes saved by admins, retrieved with `#name` or `/get name`
- Keyword filters with automatic replies (`/filter`, `/stop`, `/filters`)
- Antiflood with temporary mute (`/antiflood on|off|N`)
- Info tools (`/info`, `/id`, `/admins`, `/report`)
- Housekeeping (`/pin`, `/unpin`, `/cleanservice on|off`, `/help`, `/about`)

## Quick start

1. **Bot token** — create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. **Redis** — create a free database at [Upstash](https://console.upstash.com) and copy the REST URL + token.
3. **AI** — create an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
4. Clone this repo and install:

   ```bash
   npm install
   cp .env.example .env   # fill in your values
   ```

### Local development

Long-polling runner (no webhook needed):

```bash
npm run dev
```

Add the bot to a test group, promote it to **admin** (delete messages + ban users rights recommended).

### Deploy to Vercel

```bash
npm i -g vercel
vercel link
vercel env add TELEGRAM_BOT_TOKEN      # repeat for every variable in .env.example
vercel env add WEBHOOK_SECRET          # invent a random string (A-Za-z0-9_-)
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel env add OPENROUTER_API_KEY
vercel deploy --prod
```

Then point Telegram at your deployment:

```bash
npm run set-webhook -- https://<your-app>.vercel.app
```

Every request is authenticated via the webhook secret token header — requests without it get a 401.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | From @BotFather |
| `WEBHOOK_SECRET` | prod | Secret sent back on every webhook call |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | ✅ | Serverless-friendly Redis |
| `OPENROUTER_API_KEY` | ✅ | AI answers |
| `OPENROUTER_MODEL` | – | Model id. Free slugs rotate often — browse [openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0). Default: `nvidia/nemotron-3.5-lightning:free` |
| `ASK_DAILY_LIMIT` | – | Per-user /ask calls per day (default 10) |

> Free OpenRouter keys allow ~50 requests/day unless you've purchased ≥10 credits
> (then 1000/day). The per-user quota protects your key from being drained.

## Architecture

```
Telegram ──webhook──▶ api/webhook.ts (secret check) ──▶ src/bot.ts (grammY singleton)
                                                        ├─ command modules (src/modules/*)
                                                        ├─ member events (welcome/goodbye/bot-lock)
                                                        └─ enforcement pipeline (guards):
                                                           cleanservice → locks → antiflood → filters → #notes
                                                        │
                                     Upstash Redis ◀────┘ (settings/warns/notes/filters/quota)
                                     OpenRouter ◀────── (/ask)
```

Settings are loaded once per update and persisted only when mutated. Filter lists are cached
in-memory per instance for 60s.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (pure logic: templates, locks, filters, quotas, AI parsing)
```

## Troubleshooting

- **Bot ignores commands in a group** — make sure it was added *after* deployment and that privacy mode allows commands (or just make it admin).
- **"I need permission to …"** — promote the bot with *Delete messages* and *Ban users* rights.
- **Empty/odd /ask answers** — try another `OPENROUTER_MODEL`; free models rotate and some emit `<think>` blocks (already stripped).
