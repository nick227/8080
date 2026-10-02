# 8080

A place to hang out in public or private rooms. Conversations are voice-first — text, audio, video, and files — and any post can be replied to, so a thread can branch instead of turning into one long line.

You can walk in as a guest and make an account later. The person who starts a room sets its name, cover, and description, and chooses whether anyone can find it or only people with the invite link.

The web app is React. The API is Fastify, with Prisma and MySQL underneath.

## Setup

You need Node 20, [pnpm](https://pnpm.io) 10, and MySQL 8.

```bash
corepack enable
pnpm install
cp .env.example .env
```

Create the database named in `DATABASE_URL` (the example uses `voice_chat_dev`), then let Prisma see that file and push the schema:

```bash
ln -s ../../.env packages/db/.env
pnpm db:push
pnpm dev
```

- App: http://localhost:5173
- API: http://localhost:3001
- API docs: http://localhost:3001/docs

Uploads are stored on local disk while you develop (`apps/server/uploads`).

If guest sign-in starts failing during local testing, guest creation is limited per IP. Set `RATE_LIMITS=off` in `.env` and restart the API.

## Tests

Server tests want their own database, and they refuse to run if it is the same one the app uses. Add this to `.env`, create that database, and push the schema to it:

```bash
# .env
TEST_DATABASE_URL=mysql://root:password@localhost:3306/voice_chat_test
```

```bash
set -a; . ./.env; set +a
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:push
pnpm --filter server test
```
