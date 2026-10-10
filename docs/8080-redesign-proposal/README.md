# 8080 — Commercial Product UX Redesign

**Developer handoff · 10 October 2026 · Proposal v1.0**

**Scope:** a theme-agnostic, incremental redesign of 8080's information architecture, navigation, collection tables, full-page entity experiences, company and personal identities, work planning, Agents/email designer, interaction quality and visual-system rules.

**Objective:** turn an increasingly capable, visually fragmented prototype into a cohesive, polished, native-feeling commercial company operations product **without rewriting business services or losing features**.

## Read in order

0. [`00-decisions.md`](00-decisions.md) — **binding decisions and execution plan; overrides anything below that conflicts.**
1. [`01-current-state-audit.md`](01-current-state-audit.md) — verified source survey, current-to-target map, and gaps needing runtime verification.
2. [`02-product-model-and-navigation.md`](02-product-model-and-navigation.md) — person/company/project/sprint ownership and proposed navigation; alternatives and decision gates.
3. [`03-page-and-collection-contracts.md`](03-page-and-collection-contracts.md) — reusable shell, collection, item, create, editor and canvas contracts.
4. [`04-design-system-and-interactions.md`](04-design-system-and-interactions.md) — semantic theme tokens, native-grade interaction, accessibility, responsive and state policy.
5. [`05-domain-flows.md`](05-domain-flows.md) — specific flows: Manage, Work, Company, Account, Agents and Email Designer, Stream.
6. [`06-implementation-plan.md`](06-implementation-plan.md) — architecture plan, strangler migration, phase gates, acceptance and regression tests.
7. [`07-decisions-and-audit-checklist.md`](07-decisions-and-audit-checklist.md) — confirmed intentions vs provisional proposals, decisions to make, and detailed developer audit tasks.

## Product thesis

8080 is a **company-owned operating environment**, not a project app. One company has many projects, sprints, tasks, members, contacts, inventory items, documents, communication agents, calendars and conversations. An individual has a personal account independent of their company memberships. The company's name, logo and identity anchor the application without turning company branding into an application theme.

**Proposed experience:** a compact company identity control and prominently visible user avatar; grouped **Work** (Tasks, Projects, Sprints; Board and Calendar as rich modes), **Manage** (Contacts, Inventory, Team, Agents, Documents), and **Stream**; Company overview accessible through the company identity with advanced configuration behind a Settings action. The exact top-level grouping should be validated in prototype before becoming irreversible product policy.

**Presentation foundation:** `CollectionWorkspace` for comparable tabular collections; `ItemWorkspace` for individual full-page viewing and substantial editing; `CreatePage` following the same spatial anatomy; special-purpose `BoardCanvas`, `CalendarCanvas`, `StreamCanvas`, and immersive editor modes. Share contracts, **not domain schemas**. No data should be merged just because it can be displayed in a table.

## Hard requirements

- Theme-agnostic structural rules; preserve existing themes and content semantics.
- Preserve route/deep-link integrity and browser history.
- The universal collection remains a **navigation organization**, not a universal database table.
- Dynamic `New` action follows selected collection and authorization; substantive create/edit interfaces are full pages, not modals/slideouts.
- Item page is standard across domains; optional inspector is **not** required for first-class editing.
- Keep Board, Calendar and Stream specialized. Board remains substantial; sharing task data does not require a single task screen.
- Keep Company overview inline editable; hide advanced fields/variables/vocabulary/integrations/permissions behind Company Settings sections, **not delete them**.
- Elevate user avatar and add personal profile/account surface outside any company context; keep membership-specific team profile separate.
- Agents and their email designer follow the same item/editing architecture, preserving email senders, audience logic, trigger/scheduling, draft/publish semantics and testing.
- Sprints and Projects become first-class Work entities and feed task filters, Board and Calendar; avoid enforcing Scrum or a project-owned sprint model prematurely.
- Ship through incremental gates with real regression tests and feature parity, not a visual rewrite.

## Status of evidence

Source files on GitHub `nick227/8080` **main** were inspected via GitHub connector during this conversation, including navigation, Room shell, Work/Company/Calendar/Team/Records/Documents/Agents, styles, and detail editors. Repository tree reported SHA `8b9d2ab1804907317647f962be0d1c8f1af5cf3d` at the time of inspection. This is a **source audit**, not a complete live/browser run. Screenshots provided in conversation supplemented but do not verify every interaction or breakpoint. All proposed new entities/UX are requirements, not claims about already-shipped features. The implementing agent must recheck HEAD before changing code.

## Success definition

A user can recognize their company and their account, discover every core feature quickly, switch from collection to item and back without losing context, create any substantial entity in a coherent full-page environment, work fluently by mouse or keyboard, and enjoy consistently legible, beautifully composed interfaces under every theme. No existing agent, document, task or collaboration capability silently disappears.

## Final addenda — binding build decisions

`00-decisions.md` supersedes these where they conflict. Read [`09-final-decisions.md`](09-final-decisions.md), [`10-theme-regression.md`](10-theme-regression.md) and [`11-developer-execution.md`](11-developer-execution.md) **before coding**. They override alternative navigation experiments in prior documents. The mockup with a persistent full sidebar was exploratory and must not be copied literally.
