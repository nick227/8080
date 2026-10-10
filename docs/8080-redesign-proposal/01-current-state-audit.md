# 01 — Current-state research and mismatch inventory

## Evidence method and boundaries

Surveyed repository `nick227/8080` `main` (tree SHA `8b9d2ab1804907317647f962be0d1c8f1af5cf3d` at inspection). Evidence names below refer to source paths under `apps/web/src/`. Current browser screenshots additionally show small uppercase navigation, competing dense toolbars and a persistent chat rail; they are snapshots, not definitive responsive or interaction evidence. **Verify again against latest HEAD and a running build before implementation.** Severity levels are judgments from code/screenshot review, not usability-test measurements.

## Current page routing is not one-page-per-route

`app/routes.tsx` declares root `/`, `/room/:roomId`, `/room/:roomId/tasks`, and `/room/:roomId/tasks/:taskKey`. Most of the ten visible destinations are **desk state within `views/Room.tsx`**, not independent React Router pages. `features/work/sections.ts` declares `Desk = tasks | company | stream | team | inbox | contacts | inventory | documents | calendar | board | agents`, with visible labels **Project, Tasks, Stream, Team, Contacts, Inventory, Documents, Calendar, Board, Messaging**. `inbox` exists but is intentionally omitted from displayed nav; do not accidentally expose or delete it in the redesign. `Messaging` maps to internal `agents`, **not room chat**.

`views/Room.tsx` wraps `WorkNav` and view switching in `ChatShell`; Stream uses `RoomFloor`, Team uses `TeamDesk`, Calendar uses `CalendarPage`, and others use `WorkPage`. `features/work/WorkPage.tsx` switches Company, Documents, Inbox, Contacts, Inventory, Tasks, Board and Agents; Tasks/Board/Calendar all call `CalendarExperience` with different section values. Global chat is separately docked via `room/ChatShell.tsx`, with `closed | open | full` modes persisted in localStorage. These are important migration boundaries.

## Ten visible destinations — current implementation to target anatomy

| Displayed page | Current view composition | Existing strengths to preserve | Mismatches/risks | Target |
|---|---|---|---|---|
| **Project** (`company`) | `company/CompanyDesk.tsx`, `SectionHeader`, two-column profile/gallery vs metrics/integrations; embedded `CalendarExperience section="table"`; vocabulary via `FormSlideout` | Existing company/profile/services/integrations/vocabulary, edit permissions | Mixed overview/admin/task table, competing page rhythm, a misnamed company-level area | **Company Overview** (inline edit) + **Company Settings** (full page sections); task table stays in Work |
| **Tasks** (`tasks`) | `calendar/CalendarExperience.tsx` supports table/list, board, reports, saved views, filters, import/new, workflow editor; `TicketPage.tsx` full/page-or-panel | Shared task state/filters, deep links, reports, workflow, keyboard behavior | Multi-band header, panel/full detail divergence, task editor distinct from records, modal/slideout new task | **Work → Tasks collection**, consistent table/Item/Create; retain specialized alternate modes/reports where valuable |
| **Stream** | `room/RoomFloor.tsx` with grid/table, participant tiles, audio/video playback, recording, invites; chat via `ChatShell`/`ChatStream` | Real-time media, density/layout, fullscreen and chat | Exceptional canvas squeezed by same nav/chat shell, duplicated Team naming | **StreamCanvas** retains immersed media and its own controls; use shared shell boundaries only |
| **Team** | `team/TeamDesk.tsx`, `TeamTableView.tsx`, `UserProfilePage.tsx`, task assignment modal | Rich member work/presence/profile view | Own header, search, department chips, table, row actions and member page styling; hardcoded fallback five-person roster in `TeamTableView` requires audit | **Manage → Team collection**, standard Member item; separate **AccountProfile** from membership profile |
| **Contacts** | `inbox/ContactsDesk.tsx`→`records/RecordsExperience.tsx`, `CollectionToolbar`, `RecordChrome`, `RecordDetail`, `RecordForm`, `ContactTable` | Strong record CRUD/search, preferences, sorting, preview, timeline | Record-specific styling, preview-first variants, some forms/modal vs full-page, duplicate search layer | **Manage → Contacts** reference collection and ContactItem |
| **Inventory** | `inventory/InventoryDesk.tsx`→`RecordsExperience`/`CollectionToolbar`, `InventoryTable`, `StockAdjust`, `StockHistory` | Same underlying records framework, inventory-specific behaviors | Shared with Contacts but not Team/Documents/Agents; detail and create modes mismatch | **Manage → Inventory** reference collection + Item; preserve stock adjustment inline/lightweight where truly atomic |
| **Documents** | `documents/DocumentsExperience.tsx` list vs `DocumentShell`; `DocumentsList.tsx` separate grouped tables, new via `FormSlideout`; block/grid/map editor adapters | Distinct document types, collaborative/editor state, sheet/map functionality | Proprietary list/headers, modal/slideout create, editor unrelated to standard Item identity | **Manage → Documents collection** + DocumentItem/full immersive editors; preserve collab semantics |
| **Calendar** | `CalendarExperience section="calendar"`: month/day/list; `MonthView`, `DayView` and date controls | Calendar engine shares tasks | Date controls/filters and headers competing; currently task/day oriented | **Work → CalendarCanvas** with Tasks, Project milestones/ranges and Sprint periods, optional overlays |
| **Board** | `CalendarExperience section="board"`: board/backlog/reports; `BoardView.tsx` dnd-kit, WIP limits, quick create, rich cards | Drag-drop, workflow columns, WIP, board performance | Separate controls and quick create behavior; task item has panel variant | **Work → BoardCanvas**, preserve WIP/drag, share project/sprint filters and full-page item routes |
| **Messaging** (internal `agents`) | `agents/AgentsDesk.tsx` switches list, catalog, editor, event detail using query params; list/history tables | Scheduled/manual/team/social agents, recipient rules, executions, sender selection | Navigation label ambiguous; agent list borrows `documents/DocumentsList.css`; custom huge editor; content/designer/recipients/schedule crowded | **Manage → Agents** collection, AgentItem page + EmailDesign full editor; preserve management/history |

**Potential mismatch in naming:** "Messaging" currently means Agents management, while the right rail is room messages. Decide label (`Agents`, `Automations`, `Messaging`) with usability check; route/feature names may remain stable internally during rollout.

## Evidence: overlapping headers, tables, controls

1. **Navigation chrome**: `work/WorkNav.tsx` maps every `DESKS` entry to `work-nav-item` button and renders global search, an active-users widget, and optional Stream layout control. Search is only active for `contacts` and `inventory`; it is rendered disabled elsewhere. `work/work.css` applies compact mono/nav CSS. New nav should not repeat dead controls.
2. **Page headings**: `work/SectionHeader.tsx` is reusable but supports only title and basic `+ New`/`Import` plus arbitrary children. `company/CompanyDesk`, `calendar/CalendarExperience`, `documents/DocumentsList`, `agents/AgentsDesk`, `room/RoomFloor` use it differently. `TeamTableView.tsx` builds its own `team-table-header` with h2 and search.
3. **Tables**: `records/RecordsExperience.tsx` + `CollectionToolbar.tsx` have list/grid, filters, sort direction, columns and bulk actions. `team/TeamTableView.tsx` has a separate `team-main-table`, dedicated filter pills and inline row expansion. `documents/DocumentsList.tsx` uses multiple independently sorted `docs-table` tables. `agents/AgentList.tsx` and `AgentRiver.tsx` import DocumentsList CSS and build agent-specific tables; `agents/agents.css` sets a 1500px minimum list width. `calendar/TableView.tsx` is another task table. One visual/interaction table contract is warranted; shared domain data is **not**.
4. **Item pages**: `records/RecordDetail.tsx` has a record masthead/properties/activity pattern; `calendar/TicketPage.tsx` has a different task key/status/actions and `variant="page" | "panel"`; `team/UserProfilePage.tsx` has a hero, KPI cards, tabs and log modal; `documents/DocumentShell.tsx` renders editor adapters; `agents/AgentEditor.tsx` has custom editor header/fields/preview. Strong reason for shared Item anatomy and optional domain slots.
5. **Creation/editor divergence**: `calendar/NewTaskSlideout`, `documents/DocumentsList` new-document `FormSlideout`, `records/RecordFormDialog`/`RecordImportFlow`, `team/AssignTaskModal`, `agents/AgentCatalog` full-content create, `agents/AudienceEditor` uses `FormSlideout`, `company/VocabularySection` uses `FormSlideout`. Inventory all modal/slideout flows before replacing; complex create/edit should route to full page, atomic actions may remain inline/popover/modal.
6. **Agent complexity**: `agents/AgentEditor.tsx` has subject/body debounced save, active/draft/pause/publish/delete, sender connections, audience, delivery channels, triggers, timing, sections, templates/themes, email vs chat preview, HTML in sandboxed iframe, send-test. `AudienceEditor.tsx` handles rules/recipient count; `AgentRiver.tsx` records execution history. UX consolidation **must not strip capabilities**.
7. **Chat and spatial competition**: `room/ChatShell.tsx` remains a sibling of the work column and changes available space. Need explicit shell ownership and editor focus mode, no layout surprises when toggled.
8. **Tokens exist**: `styles/layout.css` already declares `--page-gutter`, `--page-padding-block`, `--section-gap`, toolbar/panel tokens. `styles/globals.css`, `controls.css`, and feature CSS exist. Reuse/normalize before adding a parallel token layer.

## Full-view/subview inventory to validate at runtime

- **Tasks**: table/list, board, reports, filters, saved views, import, bulk, task detail, creation, workflows, related tasks, blocked and history.
- **Board**: active columns, empty column, create inline, drag start/hover/drop/cancel, WIP limit, keyboard dragging, backlog, reporting, task open.
- **Calendar**: month/day/list, today/period switch, cell create, event/tasks and work logs, empty/overflow states; future sprint range/project milestones.
- **Team**: current people table, expanded task rows, profile, assigning tasks, camera/live presence and possible streamer/table mode distinction.
- **Contacts**: table/grid, stage/focus/tag filters, custom columns, import, bulk archive/restore, detail activity/notes/media and messaging.
- **Inventory**: list/grid, status/category/sort, add/import, detail photos/stock adjustments/history, bulk actions.
- **Documents**: grouped lists, create, block editor, grid/sheet editor, map editor, presence/conflict/recovery, external types and room links.
- **Agents**: catalog by email/team/social, agent list, execution table, agent editor, audience slideout, sender connections, test send, email HTML/text/chat preview, error/failure event.
- **Company**: identity, profile, gallery, overview stats, integrations, vocabulary, visibility/permission rules, task table, test email slideout.
- **Stream**: grid/table layout, participant fullscreen, recording, queue playback, room invites, shared chat, media and privacy/permissions.

## Audit tasks that cannot be asserted from static code

Run Playwright/browser tests at 1440, 1280, 1024, 768 and ~390 CSS px, in at least 3 visually divergent themes and both dense/standard density settings if supported. Record true focus order, contrast, toolbar clipping, scroll containers, keyboard reachability, perceived startup, loading/error states and mutation behavior. Check auth/guest, owner/member, empty/populated, multiple workspaces, slow network, offline, long names, localization/time zone and real mobile touch. Screenshot all subviews; do not report static guesses as observed runtime defects.

## Source reference index

- `app/routes.tsx`, `views/Room.tsx`, `features/work/{sections,WorkNav,WorkPage,SectionHeader}.tsx`, `features/work/work.css`
- `features/company/{CompanyDesk,CompanyProfileSection,OverviewSection,IntegrationsSection,VocabularySection}.tsx`
- `features/calendar/{CalendarExperience,TableView,BoardView,MonthView,DayView,TicketPage,NewTaskSlideout,CalendarFilters,SavedViews}.tsx`
- `features/team/{TeamDesk,TeamTableView,UserProfilePage,AssignTaskModal}.tsx`
- `features/records/{RecordsExperience,CollectionToolbar,RecordDetail,RecordChrome,RecordForm}.tsx`
- `features/documents/{DocumentsExperience,DocumentsList,DocumentShell,DocumentsHeader}.tsx`, `features/documents/editors/*`
- `features/agents/{AgentsDesk,AgentList,AgentCatalog,AgentEditor,AgentRiver,AudienceEditor}.tsx`
- `features/room/{RoomFloor,ChatShell,ChatStream}.tsx`, `styles/{layout,globals,controls}.css`

Links: https://github.com/nick227/8080/tree/main/apps/web/src
