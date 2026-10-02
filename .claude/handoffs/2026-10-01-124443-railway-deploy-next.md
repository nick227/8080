# Handoff: voice-chat-v1, foundations integrated; next is the first Railway deploy

## Session Metadata
- Created: 2026-10-01 12:44:43 (written ~13:45 CDT)
- Project: /home/administrator/web/voice-chat-v1. Claude's worktree is /home/administrator/web/voice-chat-v1-claude.
- Branch: **`main` = 5c812fe** holds everything. The main tree still has `feat/response-map` checked out (543753f), which is behind main. See Gotchas.
- Session duration: ~8 hours (audit → foundation → integration with parallel AI editors)

## Recent Commits on main (newest first)
  - 5c812fe Room: live updates re-render only the thread they touch
  - c4e86b7 Integration fixes: Room stops passing the removed Feed onSend; ignore tsbuildinfo
  - cfa82fe Merge perf/shared-audio-context (eb29fe9: one shared AudioContext)
  - c12f638 Integrate feat/response-map WIP snapshot (543753f)
  - 10bcc3f River: don't index by a null parentId
  - 5ffd4db Integrate feat/response-map (committed state)
  - 9b664d7 SDK: no focus refetch of room items; upserts copy only the changed page
  - 83f0732 River: compound keyset cursor, cursor validation, live-only results
  - d63bd65 Object storage: S3 provider, streamed uploads, ranged serving
  - ab1d95b Repair CI so it can pass and its checks mean something
  - e6bcdf3 Baseline: voice-chat monorepo as of 2026-10-01

## Handoff Chain

- **Continues from**: None (fresh start)
- **Supersedes**: None

> This is the first handoff for this task.

## Current State Summary

The session began with an adversarial audit of the schema, spec, source and foundations. We then worked through the user's sequence: foundation (git, CI, real object storage) → client scale → media runtime → River correctness. All of it is done, verified and fast-forwarded into `main`.

Other AI editors were building UI features (ResponseMap, play-in-place) in the shared main tree at the same time. Claude worked in a separate git worktree and integrated their committed work. It also committed their last uncommitted snapshot for them, labelled as such, so it could be merged.

The project is **not yet linked to Railway**. Nothing has ever been deployed, and no bucket exists. The user ended the session to do the Railway setup next time.

## Codebase Understanding

## Architecture Overview

- pnpm monorepo:
  - `apps/server`: Fastify + fastify-openapi-glue, routing driven by `packages/api-spec/openapi.yaml`.
  - `apps/web`: Vite + React 19, zustand stores, motion.
  - `apps/e2e`: Playwright; the UI owner's suites; needs running servers.
  - `packages/db`: Prisma + MySQL 8.
  - `packages/sdk`: openapi-fetch + React Query hooks.
  - `packages/shared`.
- CLAUDE.md at the repo root is the long-form project brief, including Locked Behaviors. Read it.
- **Storage (new this session):**
  - `apps/server/src/providers/storage.ts` defines the interface (`put` stream / `read` with range / `delete`).
  - `LocalStorageProvider` (dev) and `S3StorageProvider` (prod: Railway bucket or any S3-compatible store).
  - The API serves **all** media itself at `GET|HEAD /uploads/:key` (`plugins/uploads.ts`), because Railway buckets are private, with no public URLs. Size and type come from the Media row; it supports single byte ranges (206/416), ETag and immutable caching.
  - This keeps the locked CORS/ACAO behaviour that `crossOrigin="anonymous"` audio needs.
  - Uploads stream from multipart straight into storage (`MediaService.store` → `create`). Every failure path deletes the stored object.
- **Client data flow:**
  - The SDK cache (React Query) is the source of truth. `views/Room.tsx` `RoomItemsSync` mirrors it into the zustand `state/data.ts`.
  - `api/adapt.ts toItem` is cached per SDK object, so unchanged items keep their identity.
  - `features/Feed.tsx` renders a memoised `Thread` per root.
  - `components/Item.tsx` uses narrow `useUI` selectors.
- **Audio:** one shared AudioContext plus a per-element graph (`apps/web/src/components/Media.tsx`, `audioContext()` / `attachGraph`). The CLAUDE.md Locked Behaviors entry was updated to match.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| apps/server/src/providers/S3StorageProvider.ts | S3 provider (env `S3_*`) | First real use happens at deploy |
| apps/server/src/plugins/uploads.ts | multipart + the `/uploads/:key` serving route | Must be reachable at `PUBLIC_UPLOAD_BASE_URL` |
| apps/server/src/lib/session.ts | cookie options: production uses `SameSite=None; Secure` | Web and API on different domains need HTTPS on both |
| apps/server/src/app.ts | CORS from `CORS_ORIGIN` (comma list), `trustProxy` | Set to the deployed web origin |
| .env.example | every env var name, incl. the S3 block | Source for the Railway variables |
| .github/workflows/ci.yml | CI (repaired); never run (no remote yet) | Will run once pushed to GitHub |
| packages/db/prisma/schema.prisma | schema; deployed with `db push` (no migrations) | See Decisions |
| packages/db/prisma/seed.ts | wipes ALL tables; refuses non-local hosts and `NODE_ENV=production` | Never run against Railway |
| CLAUDE.md | project brief + Locked Behaviors | Long (~24KB); history should move to doc/ later |

## Key Patterns Discovered

- Services throw `{ statusCode, message, code }` via `lib/errors.ts`, and the global handler maps them. A few places still throw plain objects (cleanup item).
- Server tests (`pnpm test`, vitest) use `TEST_DATABASE_URL` and wipe every table after each test. They refuse to run if it equals `DATABASE_URL`.
- Test uploads go to a temp `UPLOADS_DIR` with a 1MB limit. Setting `STORAGE_PROVIDER=s3` plus the `S3_*` vars runs the media suite against a real bucket. Use this as the bucket check.
- Browser verification harnesses live in a previous session's scratchpad (`/tmp/claude-1000/-home-administrator-web-voice-chat-v1/1f7e982d-.../scratchpad/`). `/tmp` may be gone:
  - `audio/check.cjs`: continuous playback, AudioContext count, audibility via an analyser tap.
  - `perf/measure.cjs`: per-SSE-event main-thread cost via CDP.
  - `perf/behaviour.cjs`: focus, dwell, live reply.

  They use an isolated pair: API :3003 (`RATE_LIMITS=off`, `CORS_ORIGIN=http://localhost:5175`) and Vite :5175 with its own `cacheDir`.

## Work Completed

## Tasks Finished

- [x] Audit (Tier 0–3 findings); the user agreed a sequence
- [x] git init + baseline; CI repair (pnpm pin, `TEST_DATABASE_URL`, a drift check that couldn't fail, e2e placeholder script, web `latest` specifiers pinned)
- [x] S3 storage + streamed uploads + ranged `/uploads` serving. Verified against s3rver: 27/27 media tests, exactly one object per successful upload, a 30MB multipart upload byte-identical.
- [x] River: (createdAt, id) keyset cursor, 400 on malformed cursors, live-only results, `replyCount` excludes deleted replies, new index
- [x] SDK: no focus refetch; upserts copy only the changed page
- [x] Shared AudioContext (4 contexts → 1 for 4 clips, all audible)
- [x] Room render perf: per-event main-thread time 10.4→0.8ms (300 items), 23.5→1.3ms (900 items)
- [x] Integrated the editors' feat/response-map, fixed its type errors, merged everything into main
- [x] seed.ts production guard

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| apps/server/src/{providers/*,plugins/uploads.ts,services/MediaService.ts,handlers/media.ts,lib/range.ts} | streamed storage + serving | prod storage didn't exist; uploads were buffered whole |
| apps/server/src/services/ItemService.ts, packages/db/prisma/schema.prisma | River cursor/filters/index | posts were skipped at page boundaries; bad cursors returned 500 |
| packages/sdk/src/hooks/useItems.ts | focus refetch off; page-local upsert | full-room refetch on every focus |
| apps/web/src/{views/Room.tsx,features/Feed.tsx,components/Item.tsx,api/adapt.ts} | render isolation | O(room) work per live event |
| apps/web/src/components/Media.tsx, CLAUDE.md | shared AudioContext; locked entry updated | contexts accumulated per clip (iOS caps them) |
| .github/workflows/ci.yml, apps/e2e/package.json, apps/web/package.json, .gitignore | CI repair | CI could never pass |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Serve media through the API (`/uploads/:key`) | presigned URLs; bucket CORS | Railway buckets are private; the proxy keeps the ACAO/CSP/nosniff and crossOrigin locks unchanged. Cost: service egress. |
| Keep `POST /media` multipart, stream through the server | presigned direct-to-bucket upload | No API contract change |
| Full refetch only after a *dropped* SSE connection | `after=`/`since` catch-up | A catch-up can't restore missed deletes/reactions without a server `since` cursor; reconnects are rare |
| Claude works in a separate worktree, integrates rather than competes | editing the shared tree | Other AI editors are active in the main tree; avoids mixed commits |
| Schema deploys via `prisma db push` | `prisma migrate` | Project has no migrations folder; acceptable for the POC. Revisit before real data. |

## Pending Work

## Immediate Next Steps

1. **Link Railway.** The CLI is installed (`railway`); the Railway MCP tools are also available. Check `railway whoami` / `mcp__railway__whoami`. Create or link the project with the user present. Every Railway create action is outward-facing, so confirm each one with the user first.
2. **Provision:**
   - MySQL (Railway plugin).
   - A **bucket**.
   - An API service from `apps/server`. Start: `pnpm --filter server start` (runs tsx), or build first.
   - A web service: Vite static build of `apps/web`. `VITE_API_URL` must be set **at build time** to the API's public URL.
3. **Variables (API service):**
   - `DATABASE_URL` (reference MySQL).
   - `SESSION_SECRET`: generate one; never commit it.
   - `NODE_ENV=production`.
   - `CORS_ORIGIN` = web origin.
   - `PUBLIC_UPLOAD_BASE_URL` = `<api origin>/uploads`.
   - `STORAGE_PROVIDER=s3`.
   - `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` as references to the bucket's `BUCKET`/`ENDPOINT`/`REGION`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`. Set `S3_FORCE_PATH_STYLE=true` only if the bucket's Credentials tab says path-style.
4. **Schema:** `prisma db push` against the Railway MySQL (from a one-off command or a release step). Do NOT run `db:seed` there; the guard refuses anyway.
5. **Bucket check before the full deploy:** run the server media suite locally against the bucket (`STORAGE_PROVIDER=s3` + `S3_*` env; the suite cleans its own rows but leaves objects for successful uploads).
6. **Deploy smoke test:**
   - guest session cookie (`SameSite=None; Secure` over HTTPS)
   - create room
   - upload audio (multipart)
   - post item
   - fetch `/uploads/<key>` with `Range: bytes=0-99` → 206, ACAO present
   - SSE `/rooms/:id/stream` receives `item.created`
   - open the web app and play the audio (audible: `crossOrigin` + ACAO)

## Blockers/Open Questions

- [ ] The Railway account/project link needs the user. Not linked as of this handoff.
- [ ] Domains: two Railway domains (web and API on different hosts) work with the current cookie and CORS setup. A custom domain is the user's choice.
- [ ] Push to GitHub? There's no remote yet, and CI has never run. Ask the user before creating a remote or pushing.

## Deferred Items

- **Node 20 → 22:** CI and local are on 20; AWS SDK releases after Jan 2027 require 22. Set the Railway Node version to 22 at deploy.
- **Real lint config:** the CI lint step is a no-op.
- **Cleanup tier from the audit:** reaction counting via groupBy (≈6 queries per tap today), plain-object throws, dead code (`scripts/generate-pages.ts` etc.), OpenAPI `RiverItem` → `allOf`, splitting CLAUDE.md history into doc/.
- River: one SSE connection per visible post. Multiplex it later if it constrains real use.
- **Expired-session / abandoned-guest / orphan-media cleanup job.**
- **Dev debris:**
  - ~500 old files in `apps/server/uploads`.
  - Dev DB test rooms: "PERF 100x2", "PERF 300x2", "AUDIO CONTEXT CHECK".
  - Global git identity is the placeholder "Test" (the repo-local identity is set correctly).

## Context for Resuming Agent

## Important Context

- **Other AI editors work in the main tree** (`~/web/voice-chat-v1`). Never stage or overwrite their uncommitted files. Do your own work in the worktree `~/web/voice-chat-v1-claude` (has `main` checked out; `.env` and `packages/db/.env` are symlinks to the main tree's `.env`). Both trees share one MySQL test DB, so concurrent test runs can flake.
- **The main tree is on `feat/response-map` (543753f), behind `main`.** Before anyone continues UI work there, they must reload files and `git switch main`. Claude didn't switch it, because an editor holding stale file contents could overwrite main's Feed/Room/Item changes. Check `git status` there first.
- **The user's preferences:**
  - Separate launch blockers from optimisation.
  - Do integration review rather than competing implementations.
  - Report verified results honestly, with numbers.
  - Confirm outward-facing actions (Railway creates, pushes) first.
- Locked Behaviors in CLAUDE.md are deliberate invariants (capture/playback, CORS on `/uploads`, etc.). Change them only deliberately, and update the entry when you do.

## Assumptions Made

- Railway buckets behave as documented: private, S3-compatible, virtual-hosted URLs by default. The S3 provider is verified against s3rver only, never against a Railway bucket.
- `tsx` in production (`server start`) is acceptable for the POC.

## Potential Gotchas

- `pnpm add --filter <pkg>` twice updated the lockfile but **not** the package's `package.json` this session. Verify both after adding deps.
- `apps/web` uses `tsc -b`, which writes `*.tsbuildinfo` (now gitignored).
- Prod cookies need HTTPS on both web and API (`SameSite=None; Secure`). A plain-HTTP preview will look logged-out.
- `VITE_API_URL` is baked in at build time; changing the API URL needs a web rebuild.
- `UPLOAD_MAX_SIZE_MB` defaults to 50. Railway's proxy timeouts can matter for large uploads over slow links.
- Fastify's automatic HEAD would drain the whole object, so `/uploads` registers GET+HEAD explicitly. Keep it that way.

## Environment State

## Tools/Services Used

- Local MySQL 8: databases `voice_chat_dev` (re-seeded by an editor at 07:19 with alice/bob/... demo data) and `voice_chat_test`.
- pnpm 10.12.1, Node 20.19, Playwright 1.63 with a chromium headless shell under `~/.cache/ms-playwright`.
- Railway CLI at `~/.npm-global/bin/railway`; Railway MCP tools available. Not linked.

## Active Processes

- None. All test servers (3003/5175, s3rver :4569) were stopped.

## Environment Variables

- Server: DATABASE_URL, TEST_DATABASE_URL, PORT, SESSION_SECRET, CORS_ORIGIN, NODE_ENV, RATE_LIMITS (local only), STORAGE_PROVIDER, PUBLIC_UPLOAD_BASE_URL, UPLOAD_MAX_SIZE_MB, UPLOADS_DIR (tests), S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE
- Web (build time): VITE_API_URL

## Related Resources

- CLAUDE.md (project brief, Locked Behaviors)
- .env.example (variable names and comments)
- doc/05-anchored-replies-spec.md, doc/06-youtube-media-spec.md
- Railway buckets docs: https://docs.railway.com/storage-buckets (private; presign or proxy; Railway-provided variable names)
- Claude memory: ~/.claude/projects/-home-administrator-web-voice-chat-v1/memory/integration-pause-2026-10-01.md

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
