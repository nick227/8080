# Business templates

> Earlier epic exploration. [Blueprint Catalog and Reader](blueprint-catalog-plan.md) supersedes its customer-facing terminology and release order: browsing first, schema later, followed by whole or selective adoption into new or existing workspaces.

Epic plan · 10 October 2026 · Proposed feature scope, not implemented.

## Product definition

A **business template** is a browsable, versioned package containing a business plan, an ordered task plan and useful starting documents. It may include a separate fictional dataset for previewing how the workspace would look in use.

A person can inspect the package, choose a start date, and create a private workspace from it. They supply their own company identity, customers, team and actual business information. The template gives them a specific starting plan and workspace structure.

This makes the package itself a product object: it has a title, author, version, contents, preview, shareable URL, and editorial placement in the directory. The business depicted in a preview does not need to be a real public company.

Customer-facing names: **Business templates**, **Preview workspace**, **Use this template**, **Create workspace**. Keep “data dump,” “seed,” and “instantiate” out of the interface.

## 1. Object boundaries

| Object | Meaning | Visibility |
| --- | --- | --- |
| Business template | Reusable content and instructions, owned by an author; published versions are immutable. | Published versions can be browsed publicly. |
| Preview workspace | Read-only rendering of a specific template version, optionally with fictional examples of work in progress. | Public with explicit Template preview / Sample data labels. |
| Created workspace | Independent operational copy with new identifiers and a source-version receipt. | Private; only authorized members have access. |
| Public business profile | A real company's optionally published listing. | Separate opt-in feature; not implied by using or authoring a template. |

Browsing must clearly distinguish templates from real businesses. Initially the homepage is a Business templates catalog built from the current fictional examples. Add a Businesses filter only when real opt-in listings exist. Do not imply a community of operating businesses that has not yet joined.

## 2. The user journey

1. Browse templates by business type. Cards show the business type, author, short description, included task/document counts and a Template label. Counts come from validated package contents.
2. Open a template detail page: overview, business plan, assumptions, contents, task phases and version. Read what the user needs to supply.
3. Select **Preview workspace**. Browse Company, Lists, Board and Calendar in the shared site shell. The preview banner remains visible and says which version and demonstration date are shown.
4. Select **Use this template**. Sign in if needed, preserving the exact template version and return intent.
5. Enter company name, timezone and optional plan start date. Review what will be created. Primary action: **Create workspace**.
6. Receive a private workspace and a creation receipt. Open the tasks list with the first setup tasks visible. No automatic contacts, invitations, emails, subscriptions or scheduled sends.
7. Change the plan, add actual customers and invite real teammates through normal product flows. The copy is theirs; later edits to the source template do not alter it.

MVP creates a new workspace only. Applying a package to an existing workspace introduces merging, duplicate records and workflow mapping; defer it to a later epic.

## 3. What belongs in a template

### A. Business plan

Use a practical document with consistent sections:

- What the business sells and who it serves.
- How customers find it and how enquiries become work or orders.
- What delivery involves, including supplies, equipment and roles.
- What needs to be prepared before taking orders.
- What to review each week after opening.
- Assumptions the user must check: location, available time, premises, capacity, suppliers and relevant local requirements.

No promised earnings, fabricated traction, fake verified suppliers or universal compliance claims. If a published plan includes cost or price examples, label the currency, date, location and assumptions and verify cited sources before publication. The initial pilot can omit numerical financial estimates entirely.

### B. Task plan — the first substantial dataset

Target 25–40 useful tasks per pilot template, grouped into four phases: Setup, Prepare the offer, Find customers, Deliver and review. These are editorial targets, not fabricated UI counts.

Each task includes a stable package key, actionable title, description, completion criterion, phase/area, priority, intended role and optional relative schedule. Include an output: a completed service list, supplier comparison, enquiry form, proposal, or review note. Avoid generic tasks such as “Grow the business.”

Represent phase through the existing task `area` in the first release. A checklist can be rendered as clear description text until package importing supports native checklist/subtask materialization. Keep tasks flat in the first importer. Instructional prerequisites can refer to other task keys in the preview; do not pretend the existing backend enforces task dependencies.

Operational tasks start in the first to-do status, unassigned. The intended role is guidance, not a fake member or an automatic assignment. Do not import demonstration completion dates, comments, work logs, activity history or metrics.

### C. Starting documents

Include a business plan and two or three useful blank documents, such as a customer brief, service checklist, proposal outline or weekly review. Store plan documents in the existing server-backed block-document format. A document intended for the user's customers starts as an editable blank, with placeholders clearly marked.

### D. Demonstration data

Keep fictional contacts, orders, inventory quantities and example progress in a separate `demo` section. Use it only in the preview initially. It is not included in the operational copy. Never create fake team memberships, real-looking deliverable email addresses or a history of actions attributed to the new owner.

Preview dates use an explicit fixed reference date so screenshots and shared links are understandable. They do not become overdue work in the user's workspace. Later, an explicit “Create a practice workspace with sample data” mode could copy the demo dataset into an isolated practice workspace; that is outside MVP.

## 4. Pilot content

Start with three distinct business types instead of shallow data for all eight cards:

| Template | Focus | Reusable starting documents |
| --- | --- | --- |
| Design studio, using Fieldwork Studio as its fictional preview | Enquiry, brief, proposal, delivery and handover. | Customer brief, proposal outline, delivery checklist. |
| Bicycle repair workshop, using Switchback Cycles | Service menu, parts, intake, repair and collection. | Intake checklist, repair estimate, collection checklist. |
| Café, using Northline Café | Suppliers, menu preparation, opening tasks and daily operations. | Supplier comparison, opening checklist, weekly review. |

Publish only completed and reviewed packages. Remaining cards may stay labeled design examples until they have real contents; do not imply their Use this template action works.

### Fieldwork Studio specimen

Assumption: a small studio offering brand and website services. These example tasks describe work to do, not proof that a business is viable.

| Key | Phase | Task | Completion criterion | Suggested day offset |
| --- | --- | --- | --- | --- |
| define-services | Setup | List the services you will offer | A short service list states deliverables and exclusions. | 0 |
| choose-customer | Setup | Describe your first customer type | A written description identifies a customer need and who makes the purchasing decision. | 1 |
| check-capacity | Setup | Record your available delivery time | Weekly availability and simultaneous-project limit are documented. | 1 |
| write-brief | Prepare the offer | Adapt the customer brief | The brief asks for goals, audience, deliverables, deadline and decision-maker. | 2 |
| proposal-outline | Prepare the offer | Prepare a proposal outline | Scope, exclusions, milestones and approval steps have sections. | 3 |
| sample-work | Prepare the offer | Prepare a clearly labeled sample project | A portfolio example shows the proposed deliverables without claiming a real client. | 5 |
| enquiry-form | Find customers | Set up an enquiry form | A test enquiry reaches the channel you selected. | 6 |
| prospect-criteria | Find customers | Write criteria for potential customers | A checklist explains which businesses fit your services. | 6 |
| add-real-contacts | Find customers | Add your own potential customers | The workspace contains contacts you selected; no sample contacts are counted. | 7 |
| draft-introduction | Find customers | Draft an introduction message | A saved draft explains the service and asks a relevant question; no message is sent automatically. | 8 |
| delivery-checklist | Deliver and review | Adapt the delivery checklist | Steps cover brief approval, reviews, final files and handover. | 9 |
| weekly-review | Deliver and review | Review enquiries and delivery work | A review note records what happened and the next changes to make. | 14 |

Day offsets are suggested calendar days after the chosen start date, not duration estimates or business-day calculations. The complete pilot expands these into 25–40 tasks, adding concrete substeps where useful rather than filler.

## 5. Scheduling and adaptation

- Starting date is optional. Without one, imported tasks are unscheduled and carry their suggested relative timing in the description.
- With one, compute scheduled calendar dates from the workspace-local date plus `dayOffset`. Do not convert a date-only field through the server's timezone.
- Default due dates remain empty. Suggested scheduling must not turn into hard deadlines unless the user explicitly chooses that behavior in a later version.
- No recurring jobs in MVP. A task may instruct a weekly review without enabling automatic recurrence.
- Preserve template order through task ranks. Map known priorities and validate all statuses against the new workspace workflow.
- Substitute only declared placeholders such as company name. Show the filled business plan before or immediately after creation. Do not inject guessed customer names, addresses, credentials or member IDs.

## 6. Package and persistence model

Start with curated, schema-validated manifests in the repository as the content-authoring mechanism. Publish immutable, addressable versions to server storage through a controlled publisher; public routes read published records. Do not rely on frontend arrays as the catalog's permanent database.

Illustrative package shape:

```json
{
  "schemaVersion": 1,
  "slug": "design-studio",
  "version": "1.0.0",
  "title": "Design studio",
  "category": "Design & media",
  "author": "8080",
  "license": "<required reuse license selected before publication>",
  "assumptions": ["Small studio offering brand and website services"],
  "taskPlan": [{
    "key": "write-brief",
    "title": "Adapt the customer brief",
    "phase": "Prepare the offer",
    "description": "Ask for goals, audience, deliverables, deadline and decision-maker.",
    "completionCriterion": "The brief contains each required question.",
    "role": "Owner",
    "priority": "high",
    "dayOffset": 2
  }],
  "documents": [],
  "demo": { "referenceDate": "2026-10-01", "records": [] }
}
```

The license placeholder above is illustrative and must fail publication validation. A real package must declare asset/content reuse rights. Stock photos permitted for display are not automatically licensed for redistribution in exported packages.

Proposed additive entities:

| Entity | Responsibilities |
| --- | --- |
| `BusinessTemplate` | Stable identity/slug, author, category and current published version pointer. |
| `BusinessTemplateVersion` | Immutable version number, schema version, manifest, content digest, publication state and timestamps. |
| `TemplateInstallation` | User, source version, request key/hash, created workspace, status and stored result/receipt. |
| `TemplateInstallationItem` | Source item key → created task/document ID; supports audit, safe retry and provenance. |
| `TemplatePlacement` | Editorial collection/position and publication window; distinct from operational workspace data. |

Lifecycle: draft → published → archived. Published content cannot be edited in place. Archiving removes a version from discovery/new installations, while authorized receipts still identify the source of existing copies. New versions do not overwrite user changes. Preview URLs with an explicit version remain stable while that version is permitted to be viewed.

Avoid a generic table that stores operational tasks, contacts and documents together. The manifest is a portable package; imported records live in their existing domain tables.

## 7. Reliable creation

Current evidence: `calendar/store.ts` is a workspace-scoped optimistic cache of server tasks. `TaskService.import` already validates and imports up to 500 flat tasks through `runAction` with an idempotency key. It does not provide an atomic transaction spanning workspace creation, document creation and installation provenance. `ImportTaskRow` also does not currently expose a dependency graph or native checklist import.

Build one application service for **create workspace from template**:

1. Authorize a registered human account and validate the chosen published version, inputs and reuse rights. The client selects a server version; it cannot submit an arbitrary executable manifest.
2. Validate the full package and calculate all substitutions, dates and counts before writing anything. Reject unsupported schema versions and invalid references.
3. Use an idempotency key scoped to the actor and operation, plus an input hash. An identical retry returns the original result; key reuse with different inputs returns a conflict. Concurrent identical requests create one workspace.
4. For the bounded pilot (at most 100 tasks and five block documents per package), create the installation receipt, workspace, owner membership, required workspace defaults, tasks, documents and provenance in one database transaction.
5. Extract transaction-aware domain helpers from the existing services. Do not call independent HTTP creation/import endpoints and describe that as atomic. Keep task validation, numbering, workflow and audit behavior consistent with current services.
6. Emit live events only after commit; suppress template-induced assignment/mail notifications and scheduled automation activation. No imported fake activity or customer communications.
7. Return the new workspace ID and a receipt with actual created counts. A lost response is recovered by retrying with the same key or fetching the installation result. Navigate only after success.

If the package later grows to include large uploads or asynchronous transformations, introduce staged preparation and explicit recovery states. Do not expose a half-created workspace as a successful installation. In the first release, keep packages small enough for the bounded transaction.

A receipt records provenance, not a live dependency. Users may edit or delete imported records normally. Do not offer a destructive “reapply latest template” button. Later updates need an explicit compare-and-choose flow.

## 8. Preview architecture and routes

Use the same `AppShell`, collection presentation and task/card components. Supply an explicit preview data source and read-only capability set. Never hydrate the normal workspace singleton or use a made-up production workspace ID to render previews. No preview route may invoke a mutation or modify the viewer's current workspace preference.

Suggested routes:

- `/` — template discovery initially; later clearly separated templates and opted-in businesses.
- `/templates/:slug` — overview, version, plan, contents and Use this template.
- `/templates/:slug/tasks`, `/templates/:slug/board`, `/templates/:slug/calendar` — preview surfaces, using `?version=1.0.0` for a pinned version.
- `/templates/:slug/tasks/:sourceKey` — inspect one task and its completion criterion.
- `/workspaces/new?template=:slug&version=1.0.0` — configure an operational copy.
- `/c/:workspaceId…` — the ordinary private workspace after creation.

Suggested APIs: public published-template list/detail/version reads; authenticated creation/installation-result endpoints; publisher-only draft/publish/archive/placement writes. Define them in OpenAPI and generate the SDK before consumers depend on them.

Keep authoring restricted to the 8080 editorial team for MVP. Community submissions, package uploads, ratings, paid templates, forks and update merging are later work.

## 9. Browsing and promotion

Templates can be shared and promoted without making a company public. Use editorial collections such as “Service businesses,” “Shops,” and “Food businesses.” Show author, version and actual contents on cards/detail pages.

“Featured” is an editorial placement with an explicit label. “Most used” requires real completed-installation counts, excluding retries and internal tests. Do not seed fake popularity, activity, reviews, followers or revenue. Sponsored placements, if introduced later, need their own visible label.

First useful measurements: template opened, preview inspected, creation started, creation completed, and first meaningful edit to an imported task. Track actual events with a stated counting policy; do not use raw reloads or repeated retries as successful adoption.

## 10. Work breakdown and release gates

| Milestone | Deliverable | Done when |
| --- | --- | --- |
| S0 — Shared shell | Implement `15-site-shell.md`. | Navigation, geometry and collapse/expand tests pass across all route families. |
| T1 — Package contract | Manifest schema, validator, immutable versions and one complete design-studio package. | Every task has a useful output; required rights/assumptions are recorded; invalid packages cannot publish. |
| T2 — Discovery and preview | Catalog/detail/version routes and read-only task list/board/calendar preview. | Search/filter/Back work; preview uses no private APIs or mutations; labels distinguish demo data. |
| T3 — Operational copy | Named creation, date adaptation, atomic idempotent install, provenance receipt. | Failure rolls back, concurrent retries produce one workspace, source stays unchanged, new workspace is private. |
| T4 — Content pilot | Bicycle workshop and café packages, edited using the same content standard. | Each package is complete and independently reviewed; real claims are verified before publication. |
| T5 — Editorial placement | Featured collections and adoption events. | Placement changes only the catalog; counts are factual; publication/archival behavior is tested. |

S0 and T1 can be developed independently; previews depend on the shared shell and contract. Ship one complete template end to end before expanding the catalog.

Critical tests: package validation; hostile/unexpected markup handling; permissions; read-only preview isolation; transaction rollback; concurrent/repeated submissions; input-hash mismatch; date math across timezones and DST; no fake contacts or members in the new workspace; no automatic sends; provenance; source immutability; existing task edit/board/calendar behavior; old deep links; shared-shell geometry and reversible nav collapse.

## 11. What this planning pass settles

- The reusable business package is a first-class object.
- Tasks plus useful documents are the first operational payload.
- Demo activity is separate from the user's new business.
- A template is copied into a new private workspace, with the exact version recorded.
- The directory promotes templates honestly; real public businesses remain a separate opt-in feature.
- Shell work is the common foundation, not a template-only layout.

Final package copy, reuse license, creator attribution rules and any verified cost assumptions are publication work. No templates, backend entities or installs have been created in this planning pass.
