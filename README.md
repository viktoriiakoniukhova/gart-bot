# gart-bot

Telegram bot for PT/client workout management.

## Stack

- Bun + TypeScript (strict)
- grammY + Conversations plugin
- Prisma ORM + PostgreSQL
- node-cron for scheduling

## Setup

```bash
bun install
cp .env.example .env
# fill in BOT_TOKEN, DATABASE_URL, PT_TELEGRAM_ID, CLIENT_TELEGRAM_ID
bun db:migrate
bun dev
```

## Commands

### PT

| Command | Description |
|---|---|
| `/newworkout` | Create a new workout (step-by-step conversation) |
| `/clone` | Clone a past session as today's base |
| `/history` | List the last 10 sessions |

### Client

| Command | Description |
|---|---|
| `/today` | View today's workout (triggers read receipt to PT) |
| `/session` | View current package progress |

## Scheduler

Runs automatically while the bot is online:

- **7:30am** on Mon/Wed/Fri — delivers workout to client; warns PT if none is saved
- **9:00pm** the night before a training day — reminds PT if no workout is prepared

## Scripts

```bash
bun dev          # run with file watching
bun start        # run without watching
bun db:migrate   # create and apply a new migration
bun db:generate  # regenerate Prisma client
bun db:deploy    # deploy migrations + regenerate (for production)
```
