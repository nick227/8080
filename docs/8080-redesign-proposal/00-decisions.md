# 00 — Binding decisions and execution plan

**Status:** binding, 10 October 2026. **This document overrides any conflicting language in 01–14.** Those remain reference material (audit, contracts, domain detail, test ideas). Where they disagree with this page, this page wins.

The product direction is unchanged: Work / Manage / Stream, company identity and personal account kept apart, full-page items, one collection anatomy with domain-specific data, Board / Calendar / Stream kept specialized, Agents kept separate from chat.

## 1. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Company-rooted application.** A room is a destination inside a company, not the owner of the app. Introduced incrementally: one current-workspace resolver first, then company routes, with every existing `/room/:roomId…` URL kept working. Resolver order: `/c/:workspaceId` (must be a membership) → on a room page, the room's linked company if you belong to it (D3) → the company this browser last chose → the first membership. A `/c/:id` you don't belong to (or that doesn't exist) shows a not-found page with a link back; it never falls back to another company under that URL. Opening `/c/:id` remembers it as the current company. | Approved |
| D2 | **Stream includes the original conversation product**: room list and discovery, create/join, room chat and history, live participants and media, guest access and invite links. The Lobby stays an account-level landing page. | Approved |
| D3 | **Rooms attach to a company through a link table** (`WorkspaceRoom`, shaped like `DocumentRoomLink`), not through `Room.workspaceId`. Rooms stay platform-level (doc 09 D5 holds): linking a room to a company changes where it is listed, never who can see it. **A room links to at most one company** (unique `roomId`, allowed because the table is new). The company's shared channel is linked automatically. Membership-based room access, if ever wanted, is a separate permissions decision. | Approved (additive schema, Phase 2b) |
| D4 | **The chat rail keeps current-room context.** "Global chat" never merges histories from several rooms. A conversation selector may switch rooms. On company pages (`/c/:id/…`), where no room is open, the rail shows the company's shared channel (the existing workspace channel room); until that is wired, the rail is collapsed there. | Approved |
| D5 | **Active agents eventually get a published revision plus an editable draft.** The runner reads only the published revision; `scheduleNext` runs on publish, not on save. The draft covers *everything* that affects a send: sender, `recipientConfig`, `deliveryConfig`, `ruleConfig`, template, theme and `AgentMessage` content. Additive schema; its own backend epic, not part of the visual overhaul. | Approved direction, not scheduled |
| D6 | **Until D5 ships, editing an active agent changes its live configuration**, and the editor says so: "Saved changes apply from the next scheduled delivery." (neutral styling, not an error colour). Save, Test, Activate/Resume and Pause stay distinct actions. | Approved, Phase 1 |
| D7 | **Customer-facing labels:** `Messaging` → **Automations** (internal `agents` route, types and API unchanged); `Project` (the company desk) → **Company**. | Approved, Phase 1 |
| D8 | **Who sees what.** A *guest* never belongs to a company: Lobby plus the conversations they joined; no Work or Manage anywhere, including the work nav inside a room (hidden for them from Phase 2). A *registered account with no company*: same as a guest plus a "Create a company" entry in the Lobby and avatar menu. A *member*: everything for their companies; inside a room linked to a company they don't belong to, they see only the conversation. | Approved |

## 2. Phases

| Phase | Scope |
|---|---|
| 0 — Foundation | `useCurrentWorkspace()` as the single resolver (replaces every `useMyWorkspaces().data?.[0]`); company-rooted route plan; guest / Lobby / Stream placement (D1–D4, D8). |
| 1 — Quick wins | D7 labels; remove the fake Team roster; remove the search box where it does nothing (real global search is Phase 2); drop the fade/scale on every route change; D6 notice. |
| 2 — Shell | Company routes (§4), company identity, Work / Manage / Stream, prominent avatar, account profile, Cmd/Ctrl+K palette (with a visible "Go to…" control for touch). The palette navigates only; searching records (contacts, tasks, documents) joins it in Phase 4 with each domain. Projects and Sprints stay out of the nav until Phase 6 (no empty entries). |
| 2b — Stream epic | D3 `WorkspaceRoom` table + API, `/c/:id/conversations`, the D4 company-channel rail. The Stream tab in the shell links to the Lobby until this lands. |
| 3 — Shared UI | Standardize page headers, collection toolbars, tables and item layouts by growing the existing `SectionHeader` and `CollectionToolbar`, not a parallel set. |
| 4 — Domains | Contacts and Inventory pilot, then Team, Documents and the existing Work surfaces. |
| 5 — Agent Studio | Discovery, full-page agent item and create, email composition, audience and schedule sections (doc 08). D5 is a prerequisite only for a "Publish changes" button. |
| 6 — Projects / Sprints | Separate epic. New tables plus nullable `projectId` / `sprintId` on tasks. |
| 7 — Polish | Interaction consistency, accessibility, responsive behavior, full theme sweep. |

## 3. Rules every phase follows

**Reuse, don't rebuild.** These already exist and new surfaces must go through them:
- `features/records/navigation.ts` `useWorkPlace`: per-desk URL/state memory and legacy-link redirects.
- `features/calendar/actions.ts` (`FIELDS`, `setField`, `openField`): the only task mutation path. A shared table cell edits a task through it.
- Saved views (`TaskView`), urgency filters (`packages/shared/src/taskUrgency.ts`), reports.
- "For you" notifications (`InboxItem`, inbox stream): this is the bell.
- Board keyboard moves and the card ⋯ menu (the non-drag move that doc 12 requires).
- Task route `/room/:roomId/tasks/:taskKey` (full page) and the `?ticket=` redirect.

**No fabricated data.** Anything shown as real (people, accounts, emails, integrations) comes from the server or isn't shown. Remaining known cases: Integrations' sample accounts (Phase 4, Company).

**Copy:** sentence case for headings, buttons and labels.

**Schema:** additive only. Deploys run `prisma db push` without `--accept-data-loss`: new tables and nullable columns are fine; a new unique index on an existing table blocks the deploy. There are no reversible migrations to write.

**Themes:** the real model is 23 presets plus light/dark, stored as `8080.theme`. There is no separate density setting (`ultra-compact` and `ultra-large` are themes); don't invent one. Each PR is checked in four contrasting presets: **dark, light, retro-terminal, ultra-large**. The full sweep (every preset) runs before release.

**Process:** migrate one surface at a time behind the existing E2E suites, not with parallel old/new paths for everything. No moderated usability studies or second navigation prototype are required before shipping a phase; change course on real use.

**Safety:** never send email unexpectedly, never widen an audience (clearing the last rule clears the audience), never fall back to another sender, never show Saved / Published before the server confirms it.

## 4. Company route plan (D1, built in Phase 2)

This replaces the illustrative paths in doc 02 (no `work/` or `manage/` segment: the nav groups desks, the URL doesn't).

```
/                              Lobby (account level; guests land here)
/account                       personal profile and settings
/c/:workspaceId                Company overview (desk "company")
/c/:workspaceId/:desk          desk ∈ tasks | board | calendar | contacts | inventory | team | documents | agents
/c/:workspaceId/tasks/:taskKey full-page task
/c/:workspaceId/conversations  the company's linked rooms (Phase 2b)
/room/:roomId…                 unchanged: a conversation (Stream). Its live floor keeps the room-level "stream" view.
```

`stream` is not a company desk segment: the room page owns the live floor, and the company's room list is `conversations`. Unknown desk segments show not-found.

Engineering changes this needs (the reviewers' blockers):
- `features/tasks/links.ts` `projectPath` / `tasksPath` and the route key in `app/routes.tsx` recognise `^/(room|c)/[^/]+` as the base, so per-desk memory keys stay stable and a desk switch or task open never remounts the page.
- `useWorkPlace` reads the desk from the path segment under `/c/…` and from `?desk=` under `/room/…`; selecting a desk under `/c` navigates to `/c/:id/:desk` (keeping that desk's remembered query).
- Desks rendered without a room: `TeamDesk` gets no seats and is told there is no room, so the presence column shows "—" (never "Not in this room" for everyone); `CompanyDesk` gets no `roomId` (the conversation-visibility control is hidden).
- The company route element calls `chooseWorkspace(id)` for a membership and renders not-found otherwise (the resolver exposes `missing`).
- `features/documents/store.ts` follows the resolved company: when it differs from the store's `workspaceId`, restart the way `openFromLink` does; `openFromLink`'s explicit workspace applies once and is then cleared (today it only prefers the remembered company over `workspaces[0]`).
- Room pages keep rendering desks in place (with the room's chat rail) until Phase 2b gives `/c` pages the company-channel rail; only then do room desk links move to `/c`. Until then the Cmd/Ctrl+K palette opens desks in place inside a room and on `/c` elsewhere.
- Old links: `/room/:id?desk=<work desk>` keeps working during Phase 2; once Phase 2b ships, it redirects to `/c/<current company>/<desk>` with the same query, and `/room/:id/tasks/:key` redirects to `/c/<owning company>/tasks/:key`, where the owning company is looked up from the task key (add a lookup endpoint in Phase 2 if none exists), falling back to the room's linked company (D3); not-found only when the viewer isn't a member of the owning company. Each step ships on its own.

## 5. Progress log

- 2026-10-10 — This document written. Phase 0 step 1 (resolver, cdc1b9e) and Phase 1 (7e7d4ef) committed.
- 2026-10-10 — Design committee round 1 (product/UX + engineering): changes requested. D1, D3, D4, D6, D8, phase 2b and §4 amended as above; Phase 1 follow-ups applied (9fd1f2d).
- 2026-10-10 — Round 2: **both reviewers signed off.** Remaining notes applied: owning-company task redirect, Documents follows the resolved company, no-room Team presence, notice wording, focus tile uses the `doing` category. Phase 0 (plan + resolver) and Phase 1 done. Next: Phase 2 shell and company routes per §4.
- Known pre-existing issues for Phase 7: 390px Team header/table overflow, agent editor From overflow on mobile, chat dock takes half the phone screen, red "Active" chip in dark, assign-task modal ignores Escape.
- 2026-10-10 — Pushed d8731c4..9bddba2. Phase 2 built: company routes (283da38), grouped work nav with company identity, Work, Manage, Stream; rooms open on their conversation; guests and no-company accounts see Stream only (035efbb); `/account`, company switcher in the account sheet, Ctrl/Cmd+K palette (8628c8f). Browser suites: routes 29/29, phase1 20/20. `apps/web/tests/tasks.mjs` and `records.mjs` fail identically on the pre-redesign baseline (stale, not in CI).
- 2026-10-10 — Phase 2 committee round 1: product/UX signed off (avatar, visible Go to, Stream → Lobby, label styling, one overview URL, palette focus trap applied); engineering requested changes, applied: Documents follow the resolved company (restart on switch, explicit link choice used once), Back from a related record keeps its desk on /c, Copy link writes the task path, old calendar links are mapped before the /c redirect and no desk renders while a redirect is pending, palette focus restore. Routes suite 36/36, phase1 20/20.
