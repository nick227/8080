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
| D9 | **One collection view for every tabular list** (user direction, 2026-10-10): Tasks, Contacts, Inventory, Team, Documents and Automations share one frame — a header whose title is the list switcher (with count and "+ New {item}"), one toolbar layout (search left, the list's filters, view controls right: columns, layout, export), and one table component (`features/collections/`: `CollectionView`, `DataTable`, `useTableState`, `ColumnsMenu`, `FilterChips`) with sortable headers, remembered column visibility, row open, keyboard row navigation and selection. Domains supply columns, cells and filters; placement never differs. **Navigation:** `Company · Lists · Board · Calendar · Stream` (Lists returns to the last list; the switcher changes it), replacing the Work/Manage groups. Board and Calendar stay canvases (their headers say "Tasks · Board" / "Tasks · Calendar"). **List state:** search, filters, sort and grouping live in the URL for every list (Back, shared links and saved views keep them); which columns are shown is a per-viewer preference (only explicit toggles are stored). **Views:** one "Views" slot in every list's bar; saved views exist for Tasks (`TaskView`) and Contacts (its view picker) and stay there until a list needs them. **Phones:** below 560px a list shows stacked rows, not a squeezed table (Phase 7). | Approved |

## 2. Phases

| Phase | Scope |
|---|---|
| 0 — Foundation | `useCurrentWorkspace()` as the single resolver (replaces every `useMyWorkspaces().data?.[0]`); company-rooted route plan; guest / Lobby / Stream placement (D1–D4, D8). |
| 1 — Quick wins | D7 labels; remove the fake Team roster; remove the search box where it does nothing (real global search is Phase 2); drop the fade/scale on every route change; D6 notice. |
| 2 — Shell | Company routes (§4), company identity, Work / Manage / Stream, prominent avatar, account profile, Cmd/Ctrl+K palette (with a visible "Go to…" control for touch). The palette navigates only; searching records (contacts, tasks, documents) joins it in Phase 4 with each domain. Projects and Sprints stay out of the nav until Phase 6 (no empty entries). |
| 2b — Stream epic | D3 `WorkspaceRoom` table + API, `/c/:id/conversations`, the D4 company-channel rail. The Stream tab in the shell links to the Lobby until this lands. |
| 3 — Shared UI (D9) | The collection view: switcher header + toolbar + `DataTable` on all six lists; streamlined nav. **Step 0:** extend `DataTable` before moving the rich lists onto it — server-controlled sort (done) and keyset paging, group-by, a controlled selection model (Tasks: Ctrl/Shift ranges, `x`, Esc), a bulk-bar slot, cells that open `FieldPickerHost` through `actions.ts`, and a Grid alternative. Then (1) Inventory (done: server sort, inline availability, Grid kept), (2) Contacts (server sort, saved views, row editor), (3) the Tasks bar and table. **Done means** the old `calendar/TableView`, the contact table and the second "More columns" control are deleted — one table, one Columns menu. |
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
- Since Phase 2b, `/c` pages carry the company channel in the rail and Work/Manage live there: a room's nav shows only the Work and Manage labels (they open the company page), old `/room/:id?desk=…` links redirect to `/c/<company>/<desk>` with their query, and the room's own settings (public/private, company listing) sit beside its Stream. Task pages opened under `/room/:id/tasks/:key` still render in the room: task keys repeat across companies, so an owning-company lookup must exist before those redirect.
- Old links: `/room/:id?desk=<work desk>` keeps working during Phase 2; once Phase 2b ships, it redirects to `/c/<current company>/<desk>` with the same query, and `/room/:id/tasks/:key` redirects to `/c/<owning company>/tasks/:key`, where the owning company is looked up from the task key (add a lookup endpoint in Phase 2 if none exists), falling back to the room's linked company (D3); not-found only when the viewer isn't a member of the owning company. Each step ships on its own.

## 5. Progress log

- 2026-10-10 — This document written. Phase 0 step 1 (resolver, cdc1b9e) and Phase 1 (7e7d4ef) committed.
- 2026-10-10 — Design committee round 1 (product/UX + engineering): changes requested. D1, D3, D4, D6, D8, phase 2b and §4 amended as above; Phase 1 follow-ups applied (9fd1f2d).
- 2026-10-10 — Round 2: **both reviewers signed off.** Remaining notes applied: owning-company task redirect, Documents follows the resolved company, no-room Team presence, notice wording, focus tile uses the `doing` category. Phase 0 (plan + resolver) and Phase 1 done. Next: Phase 2 shell and company routes per §4.
- Known pre-existing issues for Phase 7: 390px Team header/table overflow, agent editor From overflow on mobile, chat dock takes half the phone screen, red "Active" chip in dark, assign-task modal ignores Escape.
- 2026-10-10 — Pushed d8731c4..9bddba2. Phase 2 built: company routes (283da38), grouped work nav with company identity, Work, Manage, Stream; rooms open on their conversation; guests and no-company accounts see Stream only (035efbb); `/account`, company switcher in the account sheet, Ctrl/Cmd+K palette (8628c8f). Browser suites: routes 29/29, phase1 20/20. `apps/web/tests/tasks.mjs` and `records.mjs` fail identically on the pre-redesign baseline (stale, not in CI).
- 2026-10-10 — Phase 2 committee round 1: product/UX signed off (avatar, visible Go to, Stream → Lobby, label styling, one overview URL, palette focus trap applied); engineering requested changes, applied: Documents follow the resolved company (restart on switch, explicit link choice used once), Back from a related record keeps its desk on /c, Copy link writes the task path, old calendar links are mapped before the /c redirect and no desk renders while a redirect is pending, palette focus restore. Routes suite 36/36, phase1 20/20.
- 2026-10-10 — Phase 2 round 2: **both reviewers signed off.** Follow-ups applied: Documents re-checks a company switch that arrives mid-start; same-desk record links don't write ?desk= on /c (no remount); icon-only "Go to" under 420px. Phase 2 done; 2b (company rooms + channel rail, then room desks move to /c) is next.
- 2026-10-10 — Pushed Phase 2 (3c52de8). Phase 2b built: `WorkspaceRoom` + API (4dd8c3c; server 777/777), company conversations page, room listing control, channel rail, shared `useChatRows` (0f7a168), room desks moved to `/c`, room visibility beside the conversation (this commit). Routes suite 43/43, phase1 20/20. Deferred: the Lobby still says "projects" for conversations (with the "New Project" dialog and a Playwright helper) — rename together in Phase 4.
- 2026-10-10 — Phase 2b committee round 1: both requested changes, applied. D8 holds in a room listed under a company you aren't in (the API says only that it's listed; you get just the conversation). The company mark shows in a room only when the room is listed in that company. The resolver waits for the room's company before any redirect. Visiting a company page is read-only (`GET …/channel`; joining is a button). Document links open in their own company. New projects open on their room. Stream page: "Stream · Conversations in X", the channel pinned first as "Company channel", "+ New conversation" (private by default: listing never grants access). Rail header + "back to {room}". Server 779/779, routes 48/48, phase1 20/20.
- 2026-10-10 — Phase 2b round 2: **both reviewers signed off.** Nits applied: New conversation never duplicates a room on retry and its hint fits the chosen visibility; the "back to {room}" note isn't saved into a desk's memory; the room redirect also waits for its own listing query (ref aliases). Phase 2b done. Next: Phase 3 (shared page headers, toolbars, tables, item layout).
- 2026-10-10 — Pushed Phase 2b (976f84a, CI green). User redirected focus to D9 (consolidated collections + streamlined nav). Built: nav `Company · Lists · Board · Calendar · Stream`; `CollectionSwitcher`; `features/collections/` (CollectionView/Header/Bar, DataTable, useTableState, ColumnsMenu, FilterChips, useUrlSearch); Team, Documents and Automations on the shared table; Contacts and Inventory in the shared header + bar (their tables next); Tasks in the shared header (bar and table next). Search moved from the nav into each list's bar. The task workflow editor button is now "Workflow" (the shared "Columns" means show/hide columns).
- 2026-10-10 — D9 committee round 1: engineering signed off; product/UX requested changes, applied: list state in the URL (sort joins search/filters; columns are per-viewer explicit toggles), the Views slot and phone rule written into D9, Step 0 + order + definition of done in Phase 3; Inventory on DataTable (server sort, inline availability); Contacts/Inventory sort from headers in table mode, one count, "Table / Grid"; Team "+ Invite member" with a one-time link and an `/invite/:token` accept page (there was no way to invite from the UI); Tasks list drops its Board view (Board is in the nav) and the redundant period heading; Board/Calendar titled "Tasks · …"; Automations purpose under the title; the Contacts dataset tagged in Documents. Engineering shoulds: switcher keeps its visible name and uses a side-effect-free `useDeskSelect`; DataTable drops invalid ARIA and keeps focus on the same row after a sort; Columns menu Escape stays local.
- 2026-10-10 — User feedback: Stream on a company page is just the company's one shared channel. The conversations list and the room "Add to / In / Remove" listing controls are removed (the `WorkspaceRoom` table and API stay, unused, so listing can return); `/c/:id/conversations` forwards to the channel; rooms keep their Public/Private control. The dev DB had missed the `WorkspaceRoom` table (applied to test only), which made the old list 500 locally; fixed with an additive `db push`.
- 2026-10-10 — D9 convergence: all six lists run on the shared `DataTable` (Contacts 835b3ab: in-place row editor via `useRow`, server sort, saved-view columns, phone cards kept; Tasks dff2f41: picker cells via actions.ts, F2, shortcuts, Group by, store selection, Columns menu replaces "More columns"). DataTable gained useRow, groupBy, onRowKey, sortKey, editable cells, selection cap/disabled (2b235ef). Old `calendar/TableView` markup, the contact `<table>` and "More columns" are gone. The Tasks/Board header and filter bar are being consolidated by another editor (uncommitted at time of writing). Remaining: Tasks search/filters into the shared bar slot (with that editor), search while a record is open, phone stacked rows (Phase 7).
