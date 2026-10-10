# 12 — Mobile and Responsive Experience: 8080 Commercial Redesign

**Status:** developer implementation addendum. Applies to every existing theme and density. **Goal:** full functional parity at phone sizes without mechanically shrinking a desktop operations dashboard.

## A. Audit first: what exists today

Inventory actual app shell, current WorkNav, Room/ChatShell, CompanyDesk, CalendarExperience (Tasks/Board/Calendar), RecordsExperience, TeamDesk, AgentsDesk/AgentEditor, DocumentsExperience and document editors. Capture current mobile screenshots and videos at 320, 375/390, 430, 768, 1024 and 1440 CSS pixels, portrait/landscape, on iOS Safari and Android Chrome where available; test with the software keyboard open. Determine which surfaces already implement compact modes and preserve useful behaviors. Specifically investigate horizontal page overflow; sticky headers under scrolling; touch targets; app+browser back behavior; live media permissions; side panel space; table width; drag interactions; forms trapped behind the keyboard; content loss on rotation and app switch; layout under theme/density changes. Record fact versus proposed redesign in audit.

## B. Responsive product architecture

One URL, data model, and permission system across devices. Mobile uses **adaptive navigation and presentation**, not a stripped-down product. Company identity (logo/name) and user avatar remain conspicuous, with search and notifications reachable. Primary areas remain **Work / Manage / Stream**. Company overview is reached from company identity and is inline editable; Account is outside company context. Work comprises Tasks, Projects, Sprints plus dedicated Board and Calendar modes; Manage comprises Contacts, Inventory, Team, Automations, Documents. Do not introduce a distinct mobile information architecture that diverges from desktop.

### Navigation patterns

- Desktop: labeled primary navigation Work / Manage / Stream, company identity and avatar; local collection and Work mode selectors; possible optional quick-access rail **only** if non-duplicative.
- Narrow laptop/tablet: collapse optional rail; keep primary groups legible; use contextual toolbar overflow; preserve active page title and Back.
- Phone: compact header with **Company identity**, **current area**, **avatar**; one deliberate navigation surface for choosing Work/Manage/Stream, and a second level to choose a collection/view. Bottom navigation is an *option to prototype*, not an automatic requirement; if used, avoid duplicate permanent sidebar or redundant drawer. A 'More' destination may house non-primary controls, never hide the only route to Automations.
- Direct links must open specific item/editor/event even when mobile; browser Back returns to the correct collection with stored filters and scroll.
- Use accessible actual labels, active state, focus handling, and keyboard interactions; never make icons the sole discoverability path.

## C. Mobile page shapes and interaction rules

**Collection pages:** shared collection adapter, but intelligently prioritize fields. Phone default displays readable stacked records/compact rows with title, critical secondary data, status and one more action. Do not squeeze a 10-column table into 390 pixels or discard optional fields. Offer a clearly labeled **Table/Compact list** choice if useful; on mobile, a bounded horizontally scrollable table can be opt-in for dense operations. Search and filters should be visible or one tap away; active filter count and Clear must be available. Sorting via accessible menu; selection and bulk operations should not depend on shift-click. Virtualization must preserve screen-reader semantics and restore scroll location.

**Item pages:** full-page viewing and editing, with stable identity header, Back, title/status, contextual actions, properties and domain sections. Secondary properties may collapse behind named headings but must remain discoverable. Do not default to bottom sheets for substantive edits. Autosave vs explicit Save/Publish retains desktop semantics. Keep sticky primary action only when it does not obstruct fields or the software keyboard; make unsaved/error status persistent.

**Create flows:** full-page creation even on mobile. Progressive field sections; optional steps indicated by headings, not mandatory one-way wizard. Do not erase input on route change, network failure, phone rotation, or temporary backgrounding when drafts are supported. Ensure keyboard-aware vertical scrolling and label/error association.

**Company:** branded summary with meaningful operational links, inline field changes for small fields; Settings opens full-page structured administration, including fields/vocabulary, integrations and sender management.

**Profile:** avatar tap opens account menu; full personal profile editing independent from company membership. Team roster opens company member profile with role/company properties, not someone else's private account settings.

## D. Domain-specific adaptive behaviors

### Work: Tasks, Projects, Sprints
- Tasks collection defaults to readable compact cards/rows. Preserve status, assignee, priority, project, sprint and quick navigation; inline adjustments only if tap-safe.
- Projects and Sprints have true item pages with relationships and progress. Task links to project/sprint are optional. Sprints may span projects.
- Board on phone becomes horizontally navigable columns or an explicit per-column selector; preserve WIP limits, blocked markers, accessible status change and task opening. Drag-and-drop is optional enhancement; **a non-drag move action is mandatory**. Avoid accidental touch drags when scrolling.
- Calendar prioritizes mobile agenda/day with direct month toggle; show project milestones/sprint periods without flooding day cells; allow filtering layers. Swipe gestures may supplement but never replace controls. Date selection respects timezone/DST and screen-reader labels.

### Manage
- Contacts and Inventory: high-signal compact records; critical status and details; full-page create/edit; inventory stock adjustments keep safeguards/history.
- Team: prioritize people, presence and current work, with table as optional density mode; touch targets for profile and assigned work.
- Automations: visible 'Scheduled emails & automations' label, New from purpose, full-page audience/schedule and agent item. Email Studio on phone uses **Editor / Preview** switcher rather than side-by-side cramped panes. Preview has mobile+desktop device simulation and must not reinitialize typed text when switched. Sender identity, recipient count, scheduled time/timezone and test-vs-live distinctions remain obvious. No test action may silently send to a production audience.
- Documents: mobile-friendly document list and full-page editor; editor-specific toolbars scroll or collapse gracefully; preserve collaboration/presence and cursor behavior. Do not promise equal editing for complex sheets/maps until tested; disclose genuine platform limitations instead of removing routes.

### Stream and Chat
- Full chat detail below; mobile live video, permissions, chat and room controls must remain discoverable without covering active media. Audio/video actions use safe tap-sized controls and clear live/recording state.

## E. Visual, theme and performance rules

Use current semantic theme tokens, density mechanisms, supported themes, fonts/fallbacks, border/radius scales, focus and status tokens. Responsive changes may adjust layout, not hardcode light/dark. Ensure overlays and portals inherit theme; test every current theme at compact and comfortable density. Respect reduced motion, increased text size, safe area insets, virtual keyboard, pointer coarse, orientation, reduced bandwidth, and 200% zoom. Do not lock viewport zoom or depend on hover. Avoid large media backgrounds or expensive animation that competes with camera processing.

**Performance budgets:** establish baseline before promising exact numbers. Navigation responds to touch instantly; render skeletons only for genuine loading; transitions don't block input. Keep large tables/canvases performant without breaking accessibility. Preserve cached state when moving between local Work views.

## F. Required responsive component contracts

`AdaptiveShell`: company/account identity, route-aware primary navigation, region layout, safe area. `AdaptiveCollection`: desktop table + compact touch mode using same query/filter state. `AdaptiveItemPage`: full item/create and inline editing, stable actions. `AdaptiveInspector`: full route or optional drawer only for truly lightweight tools. `MobileStudioPreview`: editor/preview switching without remount-induced loss. `MediaSurface`: fit/contain video, permission prompts, resilient device orientation. `ChatViewport`: viewport+keyboard aware independent scroll and composer.

Prefer enhancing existing components over parallel mobile page forks. Preserve test IDs and route compatibility where practical.

## G. E2E acceptance matrix

1. At 390px users can locate Work, Manage, Stream, Company, Account and **Scheduled email** without hidden-only labels.
2. Manage switches five collections without global horizontal overflow or losing each collection's filter/scroll position.
3. Create/edit task, contact and agent are full pages; return restores state and text is not lost with keyboard open.
4. Board task can move columns **without drag**, and Calendar can open/edit tasks and show sprints/milestones.
5. Email Studio user composes, changes template, previews, safely tests, and explicitly activates; no accidental send.
6. Chat keyboard opening doesn't obscure composer or jump history; stream camera/audio controls usable.
7. iOS and Android browsers: upload, media permissions, orientation change, navigation Back and safe area controls.
8. All current themes and density settings render menus, tables, focus, status, buttons, video and previews legibly.
9. Screen reader and keyboard navigation works on desktop/tablet and with mobile assistive technologies.
10. 320px narrow viewport and 200% text scaling do not make required actions inaccessible.

## H. Delivery milestones

**M0** baseline mobile audit + behavior parity inventory; **M1** adaptive shell & navigation; **M2** reusable collections/item/create; **M3** domain mobile experiences incl Board/Calendar and Email Studio; **M4** Stream/chat integration; **M5** mobile accessibility + themes + performance E2E. Each milestone should show before/after images, tested devices/browsers, blockers and rollback path.
