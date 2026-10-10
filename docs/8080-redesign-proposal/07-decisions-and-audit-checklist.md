# 07 — Decisions, exceptions and audit checklist

## Confirmed directional decisions from product discussion

- 8080 is a company operating environment; companies can contain many projects.
- Theme-agnostic layout and interaction structure: visuals must remain beautiful regardless of active theme.
- Consolidate comparable collection tables *where conceptually appropriate*, not simply because all have rows.
- Standardize individual entity pages and creation/editing; substantive edits and create use full pages.
- Board, Calendar, Stream stay specialized canvases.
- Contacts, Inventory, Team, Agents, Documents are conceptually grouped as **Manage**.
- Tasks, Projects, Sprints and specialized Board/Calendar are conceptually grouped as **Work**.
- Company current features remain; overview inline editable and deeper settings behind button/area.
- Prominent avatar and personal profile outside company context; role/member profile company-scoped.
- Agent/email editor gets deliberate full-page studio-quality UX with consistent architecture.
- Dynamic New reflects current entity and authorization.
- Native desktop-level precision, reliability, keyboard use and motion discipline are explicit quality targets.

## Decisions requiring implementation/product validation

| Topic | Recommended default | Validation/risks |
|---|---|---|
| Final top nav | Company identity + grouped Work/Manage + Stream, Board/Calendar one-click within Work; prototype against original Workspace dropdown + three standalone buttons | Avoid hiding Board/Calendar, avoid many duplicated nav items |
| Left quick-nav | Optional, collapsed by default / user configurable, labeled when expanded | Only ship if discoverability/efficiency tested; don't duplicate top nav |
| Name "Messaging" | Prefer `Agents` or `Automations` for management; room chat remains chat | Marketing vocabulary/product expectation |
| Personal profile fields | Avatar/name/bio and settings global; work fields membership-scoped | Privacy, cross-company exposure and existing server models |
| Account/company URL structure | URL-first, stable links plus legacy compatibility | Current `/room/:roomId` is not a generic company route |
| Company overview metrics | compact linked work summary, no embedded full task table | Must preserve existing feature access |
| One sprint membership/task | optional single sprint field initially | Future multi-sprint history and reporting |
| Sprint status & rules | planned/active/completed, company-wide cross-project | Simultaneous sprint/timezone/rollover semantics |
| Email draft/publish | preserve existing backend semantics first; add safe staged versioning if required | Accidentally publishing live changes is high-impact |
| Save pattern | automatic for atomic fields; explicit apply/publish for complex configuration | Concurrent edits, offline, dirty state |
| Inspector/panel | never primary for substantive item editing | Some fast Board/Calendar inspections may remain optional |
| Virtualization | use when measured | A11y, sticky columns, height and focus complexities |
| Documents entity ownership | company items, rich editor separate | Existing room link/presence lifecycle |

## Source-first implementation agent checklist

- [ ] Pull latest main and record commit hash; compare against reviewed tree SHA.
- [ ] Read routes and room shell plus all 10 actual desk mappings.
- [ ] Enumerate all views/subviews including hidden `inbox` and direct task URLs.
- [ ] Draw current state diagram: company/workspace, room, membership, profile, chat, task context.
- [ ] Inventory all modals/slideouts by purpose, complexity and permissions; classify retain vs replace.
- [ ] Inventory the table behaviors per domain (search/sort/filter/columns/grid/bulk/import/pagination/empty/error).
- [ ] Inventory item pages: identity, fields, actions, activity, relationships, editing and deep links.
- [ ] Inventory agent editor mutation semantics including autosave, status transitions and send-test.
- [ ] Inspect Email connection/provider/security and audience no-broadening rules.
- [ ] Inspect Prisma schema, server handlers, OpenAPI/SDK, tasks + activity events for project/sprint migration impact.
- [ ] Capture 10 pages and key subviews under 3 themes and 5 widths including chat rail on/off.
- [ ] Prototype 2 navigation models with real labels, visible Board/Calendar access, avatar and Company.
- [ ] Measure representative task completion/time and discoverability before selecting nav.
- [ ] Confirm feature flags/redirect plan and code owner boundaries.
- [ ] Implement pilot components and E2E before broad migration.
- [ ] Preserve old functionality and test no regression through staged release.

## Avoid these pitfalls

- Don't turn Company into Project or create one tenant per project.
- Don't conflate account profile with company employee record.
- Don't merge tasks, contacts, inventory, agents and documents into a universal persistence model.
- Don't remove Board, Calendar or Stream because they share task/company data.
- Don't make seven menus/sets of tabs just to avoid a sidebar.
- Don't hide commonly needed destinations inside an unlabeled icon-only control.
- Don't leave Email Designer as an unstructured pile of settings just because it's technically inside an ItemPage.
- Don't remove email preview/test, sender integrations, audience guards, publication controls or execution history.
- Don't say Saved or Published before persistence/publish state is known.
- Don't replace a create modal with a full-page flow that loses parent project/sprint/date context.
- Don't convert complex transactional actions into silent autosaves.
- Don't treat source inspection as proof of runtime behavior.

## Developer kickoff prompt

> You are implementing the 8080 commercial UX redesign described in this ZIP. Read every markdown file, starting with the current-state audit. Fetch latest `nick227/8080` main and reconcile the findings with the actual source. First deliver a concise **discrepancy report and page-by-page parity matrix**; do not begin a broad rewrite until the gaps and navigation prototypes are reviewed. Preserve all current functionality, direct links, permission and agent delivery semantics. Implement incremental feature-flagged PRs beginning with shell contracts and the Contacts/Inventory collection/item pilot. Keep all themes operational and substantiate every claimed improvement with appropriate E2E, visual and accessibility tests. Distinguish agreed product principles from outstanding decisions in `07-decisions-and-audit-checklist.md`.
