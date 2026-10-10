# 06 — Developer implementation plan and acceptance gates

## Engineering approach: feature-parity-first strangler migration

No big-bang rewrite. Maintain old and new paths behind flags until parity tests pass. Domain services, database tables, SDK endpoints, workers and presence/media plumbing remain largely unchanged except where Project/Sprint features require new schema. Refactor CSS and layout primitives iteratively. Preserve existing app route IDs, query shapes and deep links via compatibility adapters. Recheck HEAD, active branches and migrations before modifying the repo.

## Phase 0 — reconfirm source and inventory behavioral baseline

**Deliverable:** updated evidence-backed route/view/control matrix with screenshots and coverage map. Run repository install/build/test baseline. Inventory every create/edit modal/slideout; every route/query param; existing themes; feature flags; authorization; major empty/error/sync/offline; capture screenshots at target widths/themes. Audit list of all agent sender/audience/schedule/test paths. Obtain signoff on nav prototype choices and Account vs Team semantics.

**Gate:** no missing visible capability, known source of truth for each existing workflow, baseline passing tests and screenshot/reference collection.

## Phase 1 — foundation contracts and shell

- Build/normalize semantic tokens using existing `styles/layout.css`, globals, and controls.
- New shared `PageHeader`, `ContextToolbar`, `SaveState`, `ActivityTimeline`, `ActionMenu`, `PropertyGrid`, `Empty/Error/LoadingState` primitive contracts.
- Prototype navigation alternatives (single Workspace selector vs Work/Manage controls), preserve Company/Avatar, Stream access, Board/Calendar visibility, global command search.
- Shell is sole owner of global navigation/chat/context. Implement account menu and paths for profile and Company overview/settings once product model decided.
- Implement route/history adapter with old `/room/...` compatibility; no deep-link regressions.

**Gate:** 10 existing destinations still reachable; shell works all tested themes/widths; avatar and company identity distinct; route-back state remains intact.

## Phase 2 — shared collection engine (pilot)

Pilot **Contacts + Inventory** because `RecordsExperience` and `CollectionToolbar` already share them. Extract common table, toolbar, empty/loading/error and preferences layer with domain adapters. Avoid replacing existing service hooks. Validate sort, filters, grid/list, column prefs, bulk actions, previews (if any), import, pagination and direct item open. Convert complex create/edit to full pages, preserving compact atomic actions.

Second pilots: **Team** and **Agents** collection, then **Documents** library and **Tasks** table. Use contracts, not a monolithic do-everything table. Remove `AgentList` dependency on documents CSS when migrated; Team should not use fabricated people in production. Preserve domain filters/columns and other unique behavior.

**Gate:** all five Manage collections and Tasks table meet shared anatomy and parity checklist. Bench large datasets and keyboard navigation; no merged schema/business-logic regression.

## Phase 3 — full-page Item/Create contract

Wrap existing `RecordDetail`, `TicketPage`, `UserProfilePage`, `DocumentShell`, `AgentEditor` in a common Item/Page architecture. Source-specific content stays as slots. Consolidate back, breadcrumb, title, entity status, actions, properties, activity and dirty/saved/errors. Add full Create page for each complex entity. Stop using slideouts for substantive create/edit only after parity. `TicketPage variant="panel"` may be retained privately where a deliberate quick inspector is useful, but full ItemPage is primary.

**Gate:** create, open, edit, save, navigate back, direct refresh and permission denied work for each domain; no data loss or accidental destruction on navigation.

## Phase 4 — Agent/email studio upgrade

Refactor Agent Item into Overview, Message, Recipients & Delivery, Trigger & Schedule, History. Build email split editor using existing preview infrastructure; responsive/desktop/mobile/email/chat preview, sections/template/theme/merge fields, real test send guarded by explicit destination and clear status. Promote audience rule editor to full page/large embedded section; preserve sender integrations and no-broadening semantics. Carefully audit and specify active configuration vs draft behavior before modifying publish/save logic.

**Gate:** existing agent catalog/prefabs, sender and audience paths, schedules, channel combinations, publishing, pausing, test emails, execution errors/history all run in integration and end-to-end tests. No tests delivered to unintended addresses.

## Phase 5 — Project and Sprint domain additions

Design schema/migrations (workspace owned, optional task links, permissions); validate tenancy with server and SDK. New Projects and Sprints collections and Item/Create pages. Add project/sprint selectors and filters to Tasks, Board and Calendar. Calendar layers for sprint periods/project milestones with overflow rules; preserve performance. Reporting and activity/notification workflows updated where appropriate. Avoid breaking historical task/event records and deep links.

**Gate:** create project/sprint, assign/unassign tasks, cross-project sprint, Board drag, date rendering, time zone edges, old tasks/backfill, permission checks, activity stream and reports work.

## Phase 6 — final interaction and visual consistency

Polish focused keyboard navigation, error recovery, selected/active states, transitions, reduced motion, responsive density and contrasting themes. Test all representative journeys. Remove obsolete CSS/modal workflows only after no consumers remain. Measure p95 navigation and typing/scroll response in complex collections and editors. Document final component contracts and add automated visual snapshots.

**Gate:** commercial-quality acceptance criteria below, documented known exceptions; release gradually with rollback flag.

## Testing suite expectations

1. **Component tests**: Collection toolbar slots; row keyboard, selection, sort; Item Header roles; save status; modal focus; theme token compatibility; preview shell.
2. **Routing E2E**: old room/task links; new Account/Company/Work/Manage/Stream; reload in item, Back/Forward, collection filters and scroll restoration; company-switch isolation.
3. **CRUD E2E**: new/edit for Contact, Inventory, Team member where allowed, Agent, Document, Task, Project, Sprint; validation, owner/member permission differences, cancellation, autosave failures.
4. **Agent integration E2E**: sender readiness, destination channel, recipient count/rules, no widening by dropping last filter, merge preview, schedule timezone, email test confirmation, pause/resume, history/failure, OAuth disconnected paths, draft/publish semantics.
5. **Work E2E**: task Project/Sprint assignment and subsequent display in Tasks/Board/Calendar, WIP drag, overlap/long sprint date ranges, old unassigned tasks, filters across modes.
6. **Collaboration E2E**: Stream, message rail collapse/full, capture media, document presence/concurrent edits, alerts/notifications, return from editor.
7. **Accessibility**: tab order, landmarks, labels, reduced-motion, keyboard alternatives for drag, dialogs, ARIA announcements, 200% zoom, contrast across themes.
8. **Visual regression**: at least three visual themes × desktop/tablet/mobile, populated/empty/error states, menu open, item/create/editor, Stream/Board/Calendar.
9. **Performance**: large Contacts/Agents table and long email preview, no table-wide rerender per keystroke when avoidable; no regressions in streaming/recording.

## Data change safety

Before a DB migration: inspect Prisma schema, existing company/workspace membership and role mappings, task schema/status and event model, existing imports, and all services using task metadata. Write reversible/backfill-aware migrations; tenant FKs/indices; authorization tests; migration against representative seeded/staging data and rollback strategy. Never rename Company/Workspace concept in DB without explicit need. Use additive changes initially.

## Suggested sequence of small PRs

1. Baseline audit + test inventory + design decisions (no UX changes).
2. Semantic shell tokens and shared headings/toolbars/states (style only).
3. Nav + account/company routing compatibility adapters behind flag.
4. Collection engine adapter: Contacts and Inventory.
5. Item/Create contract adapter: Contact and Inventory.
6. Manage migrations: Team, Agents list, Documents list.
7. Agent Item/Email studio and audience/full editor.
8. Tasks collection + full Task item/create + Board/Calendar shared context.
9. Projects and Sprints schema/API/UI, then Calendar layers.
10. Stream/chat integration polish and cross-theme release gate.

Order may be adjusted to avoid blockers; each PR should have testable parity and a rollback. Do not commit broad renames or global CSS rewrites together with DB changes.

## Definition of done

- One coherent shell: prominently branded company, global account avatar, meaningful grouped navigation and preserved Stream/Board/Calendar access.
- Company overview and settings clearly separated; fields/variables/integrations retained.
- Personal profile global; Team member profile membership-specific.
- Collections share headers/toolbar/table conventions; item create/edit share full-page conventions; complex modals removed.
- Agents/email design fully integrated into universal item/editor anatomy; functional parity demonstrated.
- Projects/Sprints real entities in Work with correct task references, filters and calendar presence.
- No broken deep links, lost drafts, hidden controls, accidental sends, cross-tenant leaks, inaccessible editing or theme-dependent layout glitches.
- Baseline tests, new E2E tests, performance, screenshots and release/rollback artifacts attached to handoff.
