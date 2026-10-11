# 8080 Blueprint Catalog and Reader

Current direction · 10 October 2026. This supersedes the directory-first homepage plan and the initial business-template MVP sequencing.

## Immediate milestone

Build an enjoyable public browsing and reading experience before finalizing the exchange schema. Blueprints explain how a business operates through editorial narrative, photography, diagrams, people, projects, tasks, milestones, schedules and supporting documents. They are clearly labeled fictional examples, not claims about real businesses using 8080.

Organize by operating model: Solo Operator, Lean Service Team and Project Studio initially. Shift-Based and Growth Team can follow with substantive content. Industry specialization is optional: a general model is a complete Blueprint. Keep copy literal and practical.

8080 remains a full-featured CRM and work management platform. Creating a blank workspace is the default operational starting point. Browsing a Blueprint never creates records or changes a user's workspace.

## Implemented in this working tree

- `/` is the searchable, type-filtered Blueprint Catalog with three illustrated examples.
- `/blueprints/:slug` is the Reader, with 30-day, 90-day and one-year scenarios that vary staffing, scope and illustrative budgets.
- Overview, People, Roadmap, A week of work, All tasks and Documents provide complementary views of the same structured records.
- People, projects and tasks open connected inspectors. Tasks have responsibilities, time allowances and completion criteria. Roadmaps show project spans and milestones; weeks show scheduled work and recurring routines.
- Each example has six authored projects and eighteen task definitions. Scenarios select from those records rather than duplicating them. Supporting documents include a business plan, research questions and explicit budget assumptions. Research questions are not presented as completed market research.
- Catalog and Reader share a persistent header and navigation, stable content geometry, a remembered desktop collapse preference, an always-visible restore control and narrow-screen overlays.
- Blank workspace creation, sign-in continuation and private membership shortcuts remain available.

The Catalog and Reader are read-only frontend content. Budget figures are fictional planning assumptions with stated exclusions, not an implemented workspace budget system. The shared `app/AppShell.tsx` now also wraps Workspaces, Rooms (the existing `/conversations` URL), workspace creation and account profile. Company and individual room routes remain a later shell migration; see [the shell contract](8080-redesign-proposal/15-site-shell.md).

## Content and interaction principles

Start with the operating story, then let readers inspect the evidence. Use readable documents, photographs, process diagrams, timelines and calendars where each explains something concrete. A task or role can appear in several editorial sections through its stable reference. Avoid database dumps, invented activity metrics and inert controls.

Scenarios describe assumptions rather than forecast success. Show what changes with horizon, staffing and budget, and distinguish scheduled work from unallocated capacity. Fictional people illustrate responsibilities; they are never platform accounts or automatic invitations.

## Later milestones

1. Refine the Reader and examples through actual use; expand supporting plans, research and budget documents.
2. Publish a validated, versioned Blueprint format informed by the browsing experience. AI-generated and manually authored submissions use the same format. The [earlier business-package draft](business-package/README.md) is exploratory, not the finalized contract or the Reader's input format.
3. Add private upload/generation drafts, validation and review. No generation or upload is implemented in this milestone.
4. Add complete and selective adoption into new or existing workspaces, including projects, tasks, schedules and documents. Show mappings and unsupported capabilities before writing records.
5. Support community publication, revision, comparison, sharing and adaptation with explicit authorship and reuse rights.

Company identity, branding, real employees and customer information remain the user's. Adopting a Blueprint supplies operational knowledge, not a replacement company identity. Budget support can enter the future format before a native budget application exists, provided capability limits and preservation are explicit.

## Verification

`pnpm exec tsx apps/web/tests/blueprints.check.ts` validates all three models and nine scenarios for references, unique task IDs, horizon dates, schedules and illustrative budget values.

`pnpm --filter web exec node tests/homepage.mjs` checks catalog search/filtering, shell persistence, collapse/restore, connected inspectors, scenarios, weeks, documents, workspace creation and sign-in continuation using mocked APIs. It checks desktop/mobile overflow and local images across dark, light, retro-terminal and ultra-large themes. These checks do not establish backend integration or deployment status.

`pnpm --filter web typecheck` checks application TypeScript.

## Top-level consolidation · 11 October 2026

The existing Blueprint shell was promoted to the application level, not replaced. Catalog, Reader, Workspaces, Rooms, Create workspace and Account share its header, sidebar, content scroll region, responsive drawer and remembered desktop collapse state. Rooms is the navigation label; the page title is Your conversations. Legacy URLs and guest recording/creation flows remain intact. The header retains the working navigation palette and theme selector, and signed-in accounts show an avatar or initial. Global record search and a global notifications feed are not introduced by this migration.

Catalog cards now expose people, projects, task definitions and the illustrative USD plan allowance for a shared 30/90/365-day selection. The Reader opens with that selection. Allowances explicitly exclude salaries, rent and tax; full assumptions remain in the Reader. Three developed examples remain the initial collection, with deeper content preferred over additional thin cards. The editorial content model and provisional external schema are unchanged.

## Clarity and simplicity revision · 11 October 2026

The catalog now uses compact rows with modest thumbnails, direct operating-model titles, short descriptions and ordinary text counts. People, projects, tasks and the example budget remain comparable by period. Removed promotional titles, eyebrow labels, collection numbering, oversized figures and the extra explanatory marketing section.

Reader pages use a small thumbnail beside the title and description rather than a photographic hero. Section headings name their contents: People and responsibilities, Projects and milestones, Weekly schedule, Tasks and Documents. Operational records, scenarios and connected inspectors remain unchanged. Prefer this restrained presentation for subsequent Blueprint work; do not restore magazine-cover treatments or slogan headings.

## Navigation and catalog update · 11 October 2026

Workspaces is now the default homepage at `/`, with `/workspaces` retained. Global navigation is Workspaces, Community, Blueprints, in that order. Community retains the existing `/conversations` URL and guest recording flows. The catalog moves to `/blueprints`; Reader return links lead there. Catalog search, type filters and period controls are removed. It always shows all three examples with first-30-day counts and budgets; scenario exploration remains inside each Reader. Its page heading uses the same component classes as Workspaces and Community.
