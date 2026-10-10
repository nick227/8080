# 11 — Execution brief, milestones and acceptance gates

## Developer starting instruction (do before implementation)

Audit current repo HEAD, current routes, theme catalog/variables, CSS ownership, data models, TableView/RecordsExperience/TeamTableView/AgentList/DocumentsList, CompanyDesk, Room/ChatShell, TicketPage, UserProfilePage, AgentEditor/AudienceEditor/preview/sending, calendar/board store and APIs. Compare `01-current-state-audit.md` to current implementation. Observe real browser paths, responsive screenshots and keyboard flows. Mark each finding **verified or hypothesis**; report discrepancies. Record build/test baseline and clean/dirty git state. Do not overwrite other developers' work.

## Incremental implementation phases

**0. Protect baseline:** full feature/route matrix, screenshot and theme baseline, sender/automation safety, QA plan, migration/rollback.

**1. Shared foundations:** semantic tokens, Collection/Table/Toolbar/Header/ItemPage/CreatePage/Property/Form/History, keyboard and feedback primitives. Pilot across *two different* entity types; retain domain adapters.

**2. Navigation + identity:** Company left, Work and Manage selectors with local Work Tasks/Board/Calendar modes, Stream, global search and prominent avatar. Add personal full-page profile; preserve company-member distinction, browser history and deep links. Optional rail only after evidence.

**3. Standardize existing pages:** Contacts, Inventory, Team, Documents, Tasks and Company; remove substantial modal/slideout editing in favor of full pages while preserving existing functions. Keep specialized editors and Stream architecture.

**4. Projects and Sprints:** new tenant-scoped entities, optional task references, validation/API/migrations, full collection/item/create pages, filters and calendar timeline bands/milestones. Never assume current database already has these entities.

**5. Automations + Email Studio:** discoverability, purpose-led templates, shared collection/item layout, full-page audience/schedule sections, split editor + rendered email preview, safe test/activate/pause/history. No silent bulk sends or audience broadening; preserve sender auth and live update semantics pending verification. Follow document 08.

**6. Studio polish and commercial release:** state retention, focus, animations, accessibility/performance, dense table quality, responsive overlays, visual QA for every existing theme/density. Ship progressively with targeted rollback.

## Required end-to-end user journeys

- Company → inline edit → Settings/Integrations → return with state intact.
- Avatar → global personal profile, separate company team member view and proper data access.
- Work Tasks → task item → Board → Calendar; correct filters and context restore.
- Create Project/Sprint; associate task; appear correctly in calendar across timezones.
- Switch all five Manage collections; correct data, distinct entity pages, full-page create/edit.
- Scheduled email discovered by normal wording → new agent → design → recipients → schedule → safe test → activate → pause → run-history diagnosis.
- Documents collaborative editing, Stream media/chat and previous permissions unaffected.
- All actions usable by pointer/keyboard with browser back/forward and no inadvertent lost edits.
- All themes/densities pass document 10's test matrix.

## Definition of done

No lost functionality from original ten areas; safe and reversible migrations; no tenant/permission/data isolation regressions; reliable Agent sender/recipient/delivery behavior; understandable navigation; no duplicate global nav; full-page create/edit consistency; cross-theme screenshot parity and visual QA; passing build/unit/integration/E2E and accessibility tests. Provide before/after route/component map, implementation diff summary, exact automated/manual test evidence, screenshots, known limitations, migrations and rollback steps, commits and deploy summary.

**Kickoff request to implementing agent:** First deliver audit + plan with exact files to change and tests to add; then proceed PR-sized by phase. Escalate any unresolved safety-critical semantic changes before coding them. Avoid feature-wide rewrites.
