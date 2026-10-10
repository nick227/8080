# 00 — Binding decisions and execution plan

**Status:** binding, 10 October 2026. **This document overrides any conflicting language in 01–14.** Those remain reference material (audit, contracts, domain detail, test ideas). Where they disagree with this page, this page wins.

The product direction is unchanged: Work / Manage / Stream, company identity and personal account kept apart, full-page items, one collection anatomy with domain-specific data, Board / Calendar / Stream kept specialized, Agents kept separate from chat.

## 1. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Company-rooted application.** A room is a destination inside a company, not the owner of the app. Introduced incrementally: one current-workspace resolver first, then company routes, with every existing `/room/:roomId…` URL kept working. | Approved |
| D2 | **Stream includes the original conversation product**: room list and discovery, create/join, room chat and history, live participants and media, guest access and invite links. The Lobby stays an account-level landing page. | Approved |
| D3 | **Rooms attach to a company through a link table** (`WorkspaceRoom`, shaped like `DocumentRoomLink`), not through `Room.workspaceId`. Rooms stay platform-level (doc 09 D5 holds): linking a room to a company changes where it is listed, never who can see it. Membership-based room access, if ever wanted, is a separate permissions decision. | Approved (additive schema, Stream epic) |
| D4 | **The chat rail keeps current-room context.** "Global chat" never merges histories from several rooms. A conversation selector may switch rooms. | Approved |
| D5 | **Active agents eventually get a published revision plus an editable draft.** The runner reads only the published revision; `scheduleNext` runs on publish, not on save. The draft covers *everything* that affects a send: sender, `recipientConfig`, `deliveryConfig`, `ruleConfig`, template, theme and `AgentMessage` content. Additive schema; its own backend epic, not part of the visual overhaul. | Approved direction, not scheduled |
| D6 | **Until D5 ships, editing an active agent changes its live configuration**, and the editor says so: "Changes to this active automation may affect its next scheduled delivery." Save, Test, Activate/Resume and Pause stay distinct actions. | Approved, Phase 1 |
| D7 | **Customer-facing labels:** `Messaging` → **Automations** (internal `agents` route, types and API unchanged); `Project` (the company desk) → **Company**. | Approved, Phase 1 |
| D8 | **Guests** never belong to a company. A guest sees the Lobby and the conversations they joined (Stream content they have access to); Work and Manage are not shown to them. | Approved |

## 2. Phases

| Phase | Scope |
|---|---|
| 0 — Foundation | `useCurrentWorkspace()` as the single resolver (replaces every `useMyWorkspaces().data?.[0]`); company-rooted route plan; guest / Lobby / Stream placement (D1–D4, D8). |
| 1 — Quick wins | D7 labels; remove the fake Team roster; remove the search box where it does nothing (real global search is Phase 2); drop the fade/scale on every route change; D6 notice. |
| 2 — Shell | Company identity, Work / Manage / Stream, prominent avatar, account profile, Cmd/Ctrl+K search. |
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

**Schema:** additive only. Deploys run `prisma db push` without `--accept-data-loss`: new tables and nullable columns are fine; a new unique index on an existing table blocks the deploy. There are no reversible migrations to write.

**Themes:** the real model is 23 presets plus light/dark, stored as `8080.theme`. There is no separate density setting (`ultra-compact` and `ultra-large` are themes); don't invent one. Each PR is checked in four contrasting presets: **dark, light, retro-terminal, ultra-large**. The full sweep (every preset) runs before release.

**Process:** migrate one surface at a time behind the existing E2E suites, not with parallel old/new paths for everything. No moderated usability studies or second navigation prototype are required before shipping a phase; change course on real use.

**Safety:** never send email unexpectedly, never widen an audience (clearing the last rule clears the audience), never fall back to another sender, never show Saved / Published before the server confirms it.

## 4. Phase 0 route plan (D1)

Target shapes, added beside the existing routes:

```
/                         Lobby (account level; guests land here)
/account                  personal profile and settings
/c/:workspaceId           Company overview
/c/:workspaceId/:desk     Work / Manage desks (tasks, board, calendar, contacts, …)
/c/:workspaceId/stream    company conversations (linked rooms, D3)
/room/:roomId…            unchanged; a room page, opened from Stream or the Lobby
```

Order: (1) the resolver; (2) the resolver reads `:workspaceId` from the URL when present, else the remembered workspace, else the first membership; (3) company routes render the same desks the room page renders today; (4) the room page's work nav links into company routes; old `?desk=` links redirect. Each step ships on its own.

## 5. Progress log

- 2026-10-10 — This document written. Phase 0 step 1 and Phase 1 started.
