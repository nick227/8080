# Agents — Implementation Roadmap

Terse build plan for docs 00–06. Each slice ships end to end (schema → service → API/SDK → UI → tests) and leaves the app working.

## Starting point (what exists, 2026-10-07)

| Need | Have | Gap |
|---|---|---|
| Workspace, members, member email | `Workspace` (+`timezone`), `WorkspaceMember`, `User.email` | — |
| Permissions / audit | `workspacePolicy.authorize`, `runAction`, `workspaceIntegrity` | add Agent FK pairs |
| Contacts audience | `Contact.leadStatus` (`customer`…), `primaryEmail` | no unsubscribe/suppression |
| "Becomes customer" signal | `ContactService` update (diffs `leadStatus`) + bulk `setStage` | no hook; bulk path must emit too |
| Company chat | `WorkspaceChannel` + `postSays` / `WorkspaceHost` | Agent-authored line kind |
| Curated attention | `recordActivityEvent` (`workspace-activity`) | failure events |
| Day math in workspace tz | `lib/workspaceDay.ts` | recurrence (monthly / nth weekday / daily) |
| AI writing | `bots/assistant/budget.ts`, `style.ts` (WRITING_RULES) | one "draft message" contract |
| Calendar | `features/calendar` — **device-local** (localStorage) | read-only server overlay for Agent events |
| Email sending | **none** | `EmailConnection` + providers |
| Credential storage | **none** | encrypted secrets |
| Background jobs | **none** | scheduler/job runner |

Naming: UI word is **Agent**. Tables `Agent*` don't collide (`AgentProposal` is the assistant's). Keep `AgentMessage` distinct from room `Message`.

## Decisions (2026-10-07)

1. **Sender = `EmailConnection`**, a first-class workspace model. Types: `PLATFORM`, `SMTP`, `GOOGLE`, `MICROSOFT`, `RESEND_DOMAIN`. Agents reference a connection (`Agent.emailConnectionId`), never credentials. Replaces doc 02's generic `ChannelConnection` for email; social gets its own connection model later.
2. **Default sender = "Send with 8080"** (`PLATFORM`): verified 8080-controlled domain, the client's real address as Reply-To. No password, OAuth or DNS. **Every workspace gets it automatically at creation** (backfilled for existing workspaces); nobody creates it. Then SMTP → Google OAuth / Microsoft OAuth → Resend custom domain.
   - The UI shows two choices only: **Send with 8080** and **Use my own email/domain**. `SMTP` / `GOOGLE` / `MICROSOFT` / `RESEND_DOMAIN` are connection *strategies* chosen inside "Use my own", not sender types the user reasons about.
3. **One provider interface**: `EmailProvider.test(connection)` and `EmailProvider.send(connection, message)`. S0 ships `DevOutboxProvider` + `ResendPlatformProvider`. Agent logic never branches on provider; switching a sender never touches Agent code.
4. **Credentials persist encrypted** (app-level AES-GCM, key from env, rotatable) so scheduled sends run unattended; OAuth refresh handled in the provider; a connection that can't authenticate → `NEEDS_ATTENTION`, its events fail loudly.
5. **Templates/themes are their own email presentation system** — email-safe blocks, layouts and tokens; not the Documents block model.
6. **Team Agents go live first** (internal audience, no customer-email compliance). Customer bulk email stays behind the compliance gate (S8).
7. **Retries are bounded and visible** (confirmed 2026-10-07). Supersedes doc 04/05 "no retry loop": only transient provider errors (timeout, 429, 5xx) retry, fixed backoff, max 3 attempts, each attempt recorded on the target and shown in event detail. Permanent errors (bad address, auth, rejection) fail at once.

## Slices

### S0 — Foundation (server only)
- Prisma: `EmailConnection` (+ encrypted `EmailCredential`), `Agent`, `AgentMessage`, `MessageTemplate`, `MessageTheme`, `AgentEvent`, `AgentEventDelivery`, `AgentEventTarget` (+ attempts), `DevOutboxEmail`. `deliveryConfig` separate from `recipientConfig` (doc 06 §9).
- `PLATFORM` connection created inside workspace creation (same transaction) and marked default; backfill script for existing workspaces. Reply-To defaults to the creator's account email, display name to the workspace name.
- `EmailConnection` service + API: list, update Reply-To/display name, `test`, set default. Owner/admin only via `workspacePolicy`. No "create PLATFORM" endpoint.
- Providers: `DevOutboxProvider` (dev/test, viewable outbox) and `ResendPlatformProvider`. Env picks dev outbox unless a Resend key is set.
- Type registry `services/agents/types/*`: per `typeKey` — family, channel, controls, config validators, default template/theme, `nextOccurrence()`, `resolveTargets()`. Unknown/disabled types rejected.
- Presentation: email blocks (heading, text, image, button, divider, inventory card, report section) + layouts + theme tokens → `{ subject, html, text }`. Pure, snapshot-tested. Built-ins: Plain, Basic, one distinctive HTML, Team brief.
- Job runner: in-process tick (~30 s), single instance. Claims due work by conditional update (`SCHEDULED → RUNNING`, lease timestamp; stale leases reclaimed). Per-target send with the retry rule above; dedupe check before each target (`SKIPPED`); everything lands in event history. Off in tests (`AGENTS_SCHEDULER=off`), driven by an explicit `tick(now)`.
- Done when: unit tests for registry validation, recurrence, presentation, retry classification, lease reclaim; `tick()` sends to the dev outbox; Resend sends a real test from the platform domain.

**S0 as built (2026-10-07):**
- Tables: `EmailConnection` (`strategy`, `defaultFor` = one default per workspace, encrypted `secret` column instead of a separate credential table), `Agent`, `AgentMessage`, `AgentEvent` (+ `occurrenceKey`, `leaseUntil`), `AgentEventDelivery`, `AgentEventTarget` (frozen subject/html/text, `dedupeSlot`), `AgentSendAttempt`, `DevOutboxEmail`. Agent tables hold `workspaceId`; only `Agent`/`EmailConnection` relate to `Workspace` (cascade); member/contact ids are checked by `workspaceIntegrity`.
- `MessageTemplate`/`MessageTheme` tables deferred: built-ins live in code (`@project/shared` `emailBlocks.ts` keys + `services/agents/presentation.ts`); Agents store `templateKey`/`themeKey`. Tables arrive with workspace-defined templates.
- Code: `services/agents/{connections,registry,audiences,runner,presentation}.ts`, `services/agents/email/*` (`EmailProvider`, `DevOutboxProvider`, `ResendPlatformProvider`), `lib/{recurrence,secrets}.ts`, `handlers/agents.ts`, `plugins/devEmailOutbox.ts`, `scripts/backfillEmailConnections.ts` (`pnpm --filter server email:backfill`; reading connections also backfills).
- API: `listEmailConnections`, `updateEmailConnection`, `testEmailConnection` (verbs `email.read` everyone / `email.manage` admins). "Set default" waits for S5 (only one sender exists).
- Env: `EMAIL_TRANSPORT` (dev|resend; default dev unless `RESEND_API_KEY`), `RESEND_API_KEY`, `EMAIL_PLATFORM_FROM` (required in production), `SECRET_KEYS` (required in production once own senders exist), `AGENTS_SCHEDULER=off`, `EMAIL_OUTBOX_DEV=1` (dev viewer at `/dev/email-outbox`).
- No user-visible Agent types registered yet (tests use a fixture type). Tests: `__tests__/agents.test.ts` 22/22.
- **Open:** a real send through Resend from the 8080 domain needs the key + verified domain on Railway.

### S1 — Agents shell + Team Agents (first live)
- API: list/create-from-type/get/update/publish/pause/archive/delete-draft Agent; message CRUD; `send-test`; events river (keyset, mixed future/past); event detail; cancel event. All via `authorize` + `runAction`.
- SDK hooks; Web: Agents home (cards + river), Add Agent catalog (creates draft, opens editor), editor shell (header, message, Template/Theme in place, **Sender** picker showing the connection), event detail; workspace settings → Email (connection, Reply-To, Send test).
- Daily team brief + Daily customer report: `WORKSPACE_MEMBERS` (active, with email); destinations `EMAIL` + `INTERNAL_CHAT`; one event, one `AgentEventDelivery` per destination, failing independently. Daily recurrence at a workspace-local time.
- Section builders: product-defined, deterministic queries. Brief: important activity, Agent failures, inventory below minimum, follow-ups due (calendar is device-local — add when it has a server). Report: new contacts, stage changes, follow-ups due, needs attention.
- Chat: structured Agent-authored line in the workspace channel with deep links; never posted as a member.
- Failures loud: river + editor + event detail; one `recordActivityEvent` per failed event.
- Done when: create → test → publish → next morning's event delivers by email (Resend) and chat → visible in river; browser suite. **Ship to production.**

### S2 — Manual customer email (Company announcement)
- Recipients (Customers / Leads / All) + Send now / choose time. Late binding: resolve → skip no-email → dedupe → render → freeze targets → send.
- Production: customer-audience types are hidden behind a flag until S8.

### S3 — Queue + recurrence (Company newsletter)
- N messages, `EMPTY | DRAFT | READY`, reorder; next READY message consumed per event.
- Repeat/Day/Time in workspace tz; exactly one materialized next `SCHEDULED` event per active Agent, recomputed on edit/publish/pause.
- Pre-execution cutoff (e.g. 5 min); no READY message → `FAILED` blocker event, Agent flagged blocked.
- Done when: DST and month-edge recurrence tests; blocked path visible.

### S4 — Follow-ups (Welcome a new customer)
- Emit a domain signal on `leadStatus → customer` from **both** the single update and bulk `setStage` paths, inside their transactions.
- Per-contact event `scheduledFor = now + wait`; "Send once" = dedupe per Agent + contact forever.
- Editor stat ("41 contacts became customers this month") needs a stage-change record: add `ContactStageChange` rows (recommended) or query Activity.
- Then: Follow up after a status change; Ask for a review (`company.googleReviewUrl` from CompanyProfile).

### S5 — "Use my own email/domain"
- One UI entry next to "Send with 8080". Inside it the user picks how to connect; the result is still just a sender ("Sarah · sarah@acme.com") everywhere else.
- Strategies, in order: `SMTP` (host/port/user/password, TLS; `test()` = authenticated connect + optional self-send) → `GOOGLE` OAuth (`gmail.send`; restricted scope → start Google verification early) and `MICROSOFT` OAuth (Graph `Mail.Send`), token refresh in the provider → `RESEND_DOMAIN` (create domain via Resend API, show DNS records, poll verification).
- Each strategy = one provider class + one setup step; no Agent changes. Removing an own connection falls Agents back to the workspace default after confirmation.

### S6 — Calendar + Contacts entry points
- `GET` Agent events by range; Calendar overlays them read-only ("Auto-emailing 328 customers"), click → event detail.
- Contacts: "Use selected contacts with a Manual Agent" (explicit contact-id recipient source, Manual types only).

### S7 — AI writing helper
- One `budget.ts` contract: draft/rewrite subject + blocks from the user's intent + company profile facts; returns data only, user accepts into the editor. Never at execution time. Optional one-line opener for Team reports.

### S8 — Compliance gate (unlocks customer email in production)
- Unsubscribe link + one-click `List-Unsubscribe` header, suppression list honored at resolution, sender identity + physical address in footer, Resend bounce/complaint webhooks → suppression. Marketing vs. transactional flag per type. Applies to every connection type.

### S9 — Remaining email types
- Sales catalog, New product or service (Inventory merge fields), Internal messages, other Manual types. Types whose signal doesn't exist (no-reply, job completed) stay hidden.

### S10 — Social (minimal blast radius)
- Social connections, capability checks, post fields on `AgentMessage`, social types reusing Agent/Message/Event and the same job runner. No second engine.

## Cross-cutting rules
- Every mutation through `runAction`; every related row loaded with `workspaceId`; new FK pairs in `workspaceIntegrity.ts`.
- Credentials never leave the server, never in API responses, logs or AI context.
- Edits affect future events only; frozen payload once `RUNNING`.
- Retries only per decision 7; every attempt visible.
- UI copy per doc 00 vocabulary; AI copy per WRITING_RULES.
- Tests: server suite per slice; browser suite on the isolated :3002/:5174 pair.
