# 8080

8080 is a conversation-first workspace for teams: branching voice and video conversations alongside contacts, inventory, shared documents, tasks, and scheduled team updates.

Conversations live in public or private rooms. People can participate as guests, then upgrade to an email/password account. Registered users can work in shared workspaces, where company information, business records, documents, and communication agents live. Records and documents can link back to conversations so discussions stay connected to the work.

## Features

| Area | What you can do | Current scope |
| --- | --- | --- |
| Accounts and rooms | Join as a guest, register or sign in, browse public rooms, and create private rooms with invite links. | Room owners manage room details and can rotate invite codes. |
| Conversations | Send text, voice recordings, video, images, files, and YouTube media; reply to individual posts and react. | Branching replies, timeline playback, response maps, and replies anchored to a point in media. Live updates use server-sent events (SSE). |
| Recording and editing | Preview your camera, choose devices, record a take, and add soundtracks or combine a still image with audio. | Camera backgrounds include blur, stock images, and your own image; processing happens in the browser. |
| Live video | Broadcast a camera or share a screen inside a room. | Requires LiveKit configuration. Live broadcasts are separate from recorded conversation posts. |
| Workspaces and teams | Switch workspaces, invite members, organize teams, and use company chat. | Workspace roles and permissions govern business data; guest participation is for conversations. |
| Company | Maintain a company profile, view business summaries, customize business vocabulary and pipeline stages, and manage email senders. | Company and integration settings are workspace-specific. |
| Contacts | Work in table or gallery views, search and filter records, edit fields inline, track milestones and next actions, and connect notes or conversations. | Includes ownership, tags, company associations, inventory interests, record images, activity history, merging, and reviewed imports. |
| Inventory | Manage product and service records, categories, prices, images, and stock. | Table and gallery views, stock adjustments and history, and reviewed imports. |
| Documents | Create block documents, sheets, and mind maps; share documents, link them to rooms, and work with contact datasets or imported CSV data. | Workspace block documents and native sheets support server persistence and live updates. Mind-map content remains browser-local; external document links open their provider. |
| Calendar and tasks | Use month and day views, add and complete tasks, and import task lists. | Tasks are currently stored in this browser, not synchronized across workspace members. |
| Team agents | Schedule a daily team brief or customer report for workspace members, delivered by email and/or company chat. | Includes previews, message editing, event history, delivery status, and retries. Platform email and custom SMTP senders are implemented. |
| Agent catalog | Create agents from scheduled, follow-up, manual-email, and social categories. | Broader catalog entries are scaffolding: they currently use generic content and workspace-member audiences. External social publishing and customer-triggered campaigns are not complete. |
| Chatbot workflows | Build a company profile, draft documents, work with sheets, and prepare contact briefs or proposed record changes from chat. | Deterministic workflows run without AI credentials; optional AI assists extraction and drafting. |
| Appearance | Switch between visual themes and density choices. | Uses a shared CSS-token design system. |

Business activity is surfaced in company chat. A dedicated inbound inbox is deferred and is not shown in the workspace navigation. Google and Microsoft mailbox connections are not implemented yet.

## Run locally

Use **Node.js 22.12+**, **pnpm 10.12.1**, and **MySQL 8**. The repository pins pnpm through `packageManager`.

```bash
corepack enable
pnpm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
```

Edit the root `.env` with your MySQL credentials and a session secret. Create the database named in `DATABASE_URL` (the example uses `voice_chat_dev`). The API loads the root `.env`; Vite reads the frontend environment from `apps/web/.env`.

For a fresh checkout, link Prisma to the root environment file and apply the schema:

```bash
ln -s ../../.env packages/db/.env
pnpm db:push
pnpm dev
```

If `packages/db/.env` already exists, check that it points to the intended database instead of replacing it.

| Service | Local URL |
| --- | --- |
| Web app | http://localhost:5173 |
| API | http://localhost:3001 |
| API documentation | http://localhost:3001/docs |

`VITE_API_URL` points to the API origin, without an `/api` suffix. Local uploads are stored in `apps/server/uploads`.

Start by joining or creating a room. Register an account to use the workspace desks: Company, Team, Contacts, Inventory, Documents, Calendar, and Agents.

## Configuration

The root [`.env.example`](.env.example) covers the base server, storage, and bot settings. Optional capabilities use additional variables:

| Capability | Configuration |
| --- | --- |
| API and sessions | `DATABASE_URL`, `PORT`, `SESSION_SECRET`, and `CORS_ORIGIN`. |
| Frontend | Set `VITE_API_URL` in `apps/web/.env`; it is a build-time setting. |
| Upload storage | `STORAGE_PROVIDER=local` or `s3`, plus `PUBLIC_UPLOAD_BASE_URL`. For S3, set `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; `S3_FORCE_PATH_STYLE` is optional. |
| Live broadcasts | Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` on the server. |
| Platform email | Set `RESEND_API_KEY` and `EMAIL_PLATFORM_FROM`. Production uses Resend; local development uses a development outbox unless `EMAIL_TRANSPORT=resend`. |
| Custom SMTP | Configure the sender in Company → Integrations. In production, set `SECRET_KEYS` to an encryption keyring in the form `key-id:base64-encoded-32-byte-key`. Custom SMTP sends real email even in local development. |
| Agent scheduling | `AGENTS_SCHEDULER=off` disables the background runner. |
| Room bots | `BOTS=off` silences bots; `BOTS_DEV=1` enables local tuning endpoints outside production. |
| AI-assisted workflows | Set `AI_ASSISTANT=on`, `OPENAI_API_KEY`, and `OPENAI_ASSISTANT_MODEL`. Workflow code controls actions; AI supplies extracted facts or drafts. |
| Experimental routing | `AI_ROUTER=shadow` with an API key and `OPENAI_ROUTER_MODEL` logs sampled routing decisions without acting on them. |
| Local rate limits | `RATE_LIMITS=off` disables route limits for development, including guest-session limits. |

The agent runner and live event hubs currently run in-process. The scheduler is designed for a single running instance; shared event distribution for multiple API instances is not implemented.

Virtual backgrounds use MODNet with a MediaPipe fallback. The Vite setup downloads and verifies pinned MODNet weights, caches them locally, and bundles the runtime assets for self-hosting. CI/production builds require the model download or a valid cached copy; local development can fall back to MediaPipe.

## Development

The application is a TypeScript pnpm monorepo. The frontend uses React, Vite, Zustand, and TanStack Query. The backend uses Fastify, Prisma, and MySQL, with an OpenAPI contract and generated SDK types.

| Path | Purpose |
| --- | --- |
| `apps/web` | React application, media capture/playback, workspace desks, and design system. |
| `apps/server` | API handlers, business services, storage providers, bots, and agent runner. |
| `apps/e2e` | Additional Playwright suites for capture, playback, sharing, and rooms. |
| `packages/db` | Prisma schema, client, and seed script. |
| `packages/api-spec` | OpenAPI API contract. |
| `packages/sdk` | API client, generated types, and React Query hooks. |
| `packages/shared` | Shared types, validation, limits, and business definitions. |
| `docs` | Feature documentation, agent specifications, and archived plans. |

Useful commands, run from the repository root:

```bash
pnpm dev                         # Start the web app and API
pnpm build                       # Build packages and applications
pnpm typecheck                   # Check workspace TypeScript
pnpm db:studio                   # Inspect the database with Prisma Studio
pnpm sdk:generate                # Regenerate SDK types from OpenAPI
pnpm sdk:check                   # Check generated SDK drift
```

## Tests

Server tests delete test data between cases. Use a dedicated database: the test configuration requires `TEST_DATABASE_URL` and rejects a URL identical to `DATABASE_URL`.

Add this to the root `.env`, then create the corresponding MySQL database:

```dotenv
TEST_DATABASE_URL=mysql://root:password@localhost:3306/voice_chat_test
```

Apply the schema to that database and run the server suite:

```bash
set -a
. ./.env
set +a
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:push
pnpm --filter server test
```

For browser tests, install Chromium once, then run the web suite. Its Playwright configuration starts the local app and API, or reuses an existing development server.

```bash
pnpm --filter web exec playwright install chromium
pnpm --filter web test
```

Focused frontend checks include `pnpm --filter web test:contacts`, `test:records`, `test:import-safety`, `test:maps`, and `test:theme`. The additional `apps/e2e` suites run with `pnpm --filter e2e test:e2e`; their Playwright configuration also starts or reuses the local development servers.

## Further reading

- [Contacts workbench](docs/contacts/workbench.md)
- [Communication agents](docs/agents/README.md)
- [Frontend design system](apps/web/src/styles/README.md)
- [Theme presets](apps/web/src/styles/PRESETS.md)
- [API contract](packages/api-spec/openapi.yaml)

Historical proposals and reviews are in [`docs/archive`](docs/archive); they describe design history and may differ from the current implementation.
