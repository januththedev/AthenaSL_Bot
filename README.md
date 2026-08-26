# Athena 🤖

A Rose-style Telegram group-management bot with an AI `/ask` command for students.
TypeScript · grammY · Vercel serverless · Neon Postgres · OpenRouter.

> **About "MissRose's source code":** Rose (@MissRose_bot) is closed-source and cannot be
> legally extracted or reverse-engineered from her servers. Her author's own open-source
> codebase (`PaulSonOfLars/tgbot`) is an archived Python app that can't run on Vercel
> serverless anyway. Athena is a **clean-room reimplementation** of Rose-style behavior —
> no copied code — designed from day one for Vercel webhooks.

## Features

**AI & study tools**
- `/ask <question>` — AI answers via OpenRouter; **reply to any message with /ask** to have it answered. Per-user daily limit (admins exempt).
- `/setpersona <text>` — **per-group AI customization**: admins define how `/ask` answers in *their* group only (language, curriculum, format). `/persona` to view, `/resetpersona` to clear.
- `/remind 1h30m|18:30|2026-09-01 <text>` — reminders (scheduler runs every minute) • `/reminders` • `/delremind`
- `/exam <YYYY-MM-DD> <name>` — daily countdown posted to the chat • `/exams`
- `/quiz <topic>` — AI-generated 5-question MCQ quiz with inline buttons and a scoreboard • `/quizstop`
- `/summarize` (reply) — summarize a long message or a linked article
- `/recap` — AI recap of today's chat • `/resources` — auto-indexed links shared in the group
- `/draw <description>` — AI image generation via [pollinations.ai](https://pollinations.ai) (free, no key)
- `/chart <question or data>` — **precise, data-accurate charts**: the AI extracts the real values from your question, and code renders the chart exactly (bar/line/pie, true labels & numbers — never a hallucinated drawing). `/ask` automatically attaches a chart when an answer is numeric. Shares the `/ask` daily quota.

**Group management (Rose-style)**
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

## Per-group customization

Every setting is stored **per chat id** — nothing leaks between groups. Each group can have its
own welcome text, rules, warn policy, locks, notes, filters, and — via `/setpersona` — its own
AI answer style. Example:

```
/setpersona Answer in Sinhala first, then English.
Focus on A/L Biology syllabus. Always end with one exam-style practice question.
```

## Scheduler (reminders & exam countdowns)

- **Locally:** `npm run dev` runs the scheduler every 60 s alongside polling.
- **On Vercel:** `vercel.json` ships a daily cron (Hobby plan limit). For minute-level reminders
  on Hobby, point any external pinger (e.g. cron-job.org) at `POST /api/cron` with header
  `Authorization: Bearer <CRON_SECRET>` every minute. On Pro, change the vercel.json cron
  schedule to `* * * * *`.
- Clock-based times (`18:30`) use the server timezone — **UTC on Vercel**.

## Quick start

1. **Bot token** — create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. **Database (Neon Postgres)** — easiest from inside Vercel: project → **Storage** → **Create Database** → **Neon** → pick a region near your students → Create. Vercel injects `POSTGRES_URL` automatically. (Or create directly at [neon.tech](https://neon.tech) and paste the connection string as `DATABASE_URL`.)
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
vercel env add OPENROUTER_API_KEY
vercel env add CRON_SECRET
vercel deploy --prod
# Then: Vercel dashboard → Storage → Create Database → Neon
# (links POSTGRES_URL to the project and redeploys)
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
| `POSTGRES_URL` | ✅ prod | Neon Postgres — injected automatically by Vercel's Storage → Neon integration |
| `OPENROUTER_API_KEY` | ✅ | AI answers |
| `OPENROUTER_MODEL` | – | Preferred free model. Free slugs rotate often — browse [openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0). Default: `minimax/minimax-m2.7:free` |
| `OPENROUTER_MODEL_FALLBACK` | – | Tried automatically when the primary is rate-limited or returns junk |
| `POLLINATIONS_MODEL` | – | Image model for /draw (default `flux`) |
| `ASK_DAILY_LIMIT` | – | Per-user /ask calls per day (default 10) |
| `CRON_SECRET` | prod | Protects `/api/cron` (reminders, exam countdowns) |
| `USE_LOCAL_STORE` | – | `1` = store data in a local JSON file instead of Postgres (dev) |

> Free OpenRouter keys allow ~50 requests/day unless you've purchased ≥10 credits
> (then 1000/day). The per-user quota protects your key from being drained.

### Always-free model chain

The bot only ever uses **free** models, tried in this order: `OPENROUTER_MODEL` →
`OPENROUTER_MODEL_FALLBACK` → up to 4 more `:free` models **auto-discovered** from
OpenRouter's public catalog (cached 1 h, preferring known-good families). Junk
answers ("User Safety: safe", leaked reasoning) and per-model rate limits are
skipped automatically. Note the ~50/day free cap is **account-level** — model
rotation can't bypass it; credits raise it to 1,000/day.

## Architecture

```
Telegram ──webhook──▶ api/webhook.ts (secret check) ──▶ src/bot.ts (grammY singleton)
                                                        ├─ command modules (src/modules/*)
                                                        ├─ member events (welcome/goodbye/bot-lock)
                                                        └─ enforcement pipeline (guards):
                                                           cleanservice → locks → antiflood → filters → #notes
                                                        │
                                     Neon Postgres ◀────┘ (settings/warns/notes/filters/quota)
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
- **Empty/odd /ask answers** — try another `OPENROUTER_MODEL`; free models rotate, some leak reasoning or safety fragments (already filtered), and the fallback model kicks in automatically.

---

Built by **[Januth Nimnal](https://januth.dev)** · [januth.dev](https://januth.dev)
