# 05 — Domain-specific UX: full-feature parity maps

## Manage: Contacts / Inventory / Team / Agents / Documents

All five offer a familiar `CollectionPage`: identical placement of title, dynamic New, search, filters, view/column options, table, selection and return-from-item. **Different schemas, operations and full item content**. The selector chooses a company collection; it does not change company or create a generic underlying record. Allow saved common lists; if naming ambiguous, prefer display label **Agents** over existing **Messaging** but obtain a product decision before changing labels.

### Contacts

Retain tags, stage pipeline, follow-ups/owners, import, bulk actions, saved column visibility, messaging, contact brief/media/notes/activity and profile. `ContactsDesk → RecordsExperience → RecordDetail` likely provides reusable implementation starting point. Create/edit full-page; keep compact pickers for trivial stage/owner changes.

### Inventory

Retain inventory item gallery/media, category/price/availability, stock counts/adjustments/history and bulk operations. `RecordsExperience` shares significant logic with Contacts. Avoid treating stock adjustment as plain autosave on number fields if it represents an auditable stock transaction.

### Team

Display user avatar/presence/work focus/role/assigned tasks in a standard table and full **Team Member** item. Keep room seat state and work state distinct. Remove or gate fictional fallback roster in `TeamTableView.tsx` for production if runtime audit proves it is shown as real data. A member's job title/role belongs to company membership; global account bio/avatar belongs to account. Team Member item can link to public personal profile when permissions allow. Keep assignment functionality, but prefer full Task create/edit for complex assignment; quick assign may remain inline for a single action.

### Documents

Standard library table, optional group-by type and type filters. Create full-page Document create, then enter Block/Grid/Map full editors with shared Item identity/back actions. Preserve real-time editing and conflict behavior; do not remount editors gratuitously during shell transitions. Existing `DocumentShell` delegates to adapters, so wrap rather than replace adapters.

### Agents + Email Designer (critical)

**Current** `AgentsDesk` switches `AgentList`, `AgentCatalog`, `AgentEditor`, `EventDetail`; `AgentRiver` shows history; `AudienceEditor` uses a slideout; `AgentEditor` houses sender, target, timing, subject/body, sections, style, iframe/live previews and save/publish/pause/test. Preserve endpoints and protections.

**New landing**: Manage → Agents collection. Standard columns: name, type, channel, recipient summary, trigger/schedule, next run, state, attention. Advanced fields in column selector. Domain-specific filters for draft/active/paused/error and schedule/channel. Row click → Agent Item full page; `New Agent` → full-page template catalog (with family/channel search) → creation editor. Activity history as item section and optional company-wide execution collection preset, not an unrelated table stacked by default.

**Agent Item anatomy:** identity/name/status and action menu; concise summary: purpose, next/last run, sender status, recipient count, problems. Sections inside full page: `Overview`, `Message`, `Recipients & Delivery`, `Trigger & Schedule`, `History`. Prefer anchored sections/sub-navigation when manageable; not five forced wizard steps. Message may open an immersive editor sub-route with breadcrumb back to same agent.

**Email studio:** split authoring and actual rendered preview, user-resizable where practical; modes Content / Design / Preview; preview Email/Desktop, Email/Mobile, and Internal Chat where supported. Subject, body, included dynamic sections, template, theme, merge-field examples and live realistic preview. Clearly identify sender address and Reply-To separately from audience. Email content preview must be in its own rendering context, **not tied to application theme**. Reuse existing server preview and sandboxed iframe; preserve HTML/text fallback and test send. Don't promise pixel-perfect rendering in every email client; label preview accordingly. No premature drag-and-drop HTML builder.

**Recipient editor:** substantial rule building gets full-page sub-editor or a large embedded section with full editing space, not the present restrictive slideout. Support built-in workspace members/trigger contact, selected contacts, filtered contacts, counts, sample preview and safety constraints. Removing final filter **must not implicitly widen recipients to everyone**; current code explicitly guards this. Explain when no recipients match and when audience can't be computed. Preserve all existing recipient rules.

**Delivery and auth:** user may choose approved sender connections (including Google OAuth where configured), company integrations govern sender availability, and delivery channels may include email/internal chat. Surface missing/expired sender, permissions and provider authentication errors with direct linking to Company Settings → Integrations. Do not assume sending-as privileges from login OAuth. Never silently fall back to wrong sending identity.

**Trigger and schedule:** manual/on-demand, scheduled, and event triggers use one consistent form language. Display time zone, next occurrence, status and any content dependencies. Social agent variants must retain capability or be clearly classified if incomplete; do not promise functionality not shipped.

**State model:** distinguish local editor change, saved draft/config, published/active configuration, paused and archived. **Audit the existing backend semantics before introducing true draft/publish version separation**; UI must never claim a staged-but-unpublished draft if saving currently modifies active send behavior. Migration may require a backend versioning change, but only after explicit design and tests. `Save`, `Test`, `Start/Resume`, `Pause`, `Archive/Delete` have distinct semantics, confirmations and error states. Prevent duplicate scheduling/tests and show audit history. Tests require explicit recipient confirmation.

**Historical activity:** preserve `AgentRiver` and `EventDetail`, including execution records, failures and outputs. Detail links should be stable and permissions-checked.

## Work: Tasks / Projects / Sprints + Board / Calendar

Treat Work as a cohesive operating context, not one forced table. Tasks, Projects and Sprints use the shared collection/item engine; Board and Calendar are **specialized equal-status modes**, retaining rich controls. Shared project and sprint filters carry across related views where meaningful, plus member/priority/status filters as supported. Users can always return to global/all-work view.

### Project entity (new, not current Company "Project" page)

Create/edit full page. Suggested fields: name, description/goal, owner, status, start, target end, optional color/cover and participants, related docs, milestones, tasks, progress and activity. A project is **inside the company** and does not own a separate company tenant, brand or integrations. Show progress based on clear metric and not arbitrary inferred percentages. Avoid requiring project on every task.

### Sprint entity (new)

Suggested: title, goal, start/end, state (planned/active/completed), participants/capacity optionally, task membership and completion stats, retrospective/notes if needed. Company-wide sprint can include tasks from many projects. Task may be unassigned to sprint. Define how many simultaneous active sprints are allowed; initially allow multiple unless a concrete business rule requires one. Sprint completion doesn't have to auto-close unfinished tasks: offer move-to-backlog/next-sprint actions with explicit choices. Date/time zone boundary must be defined.

### Task integration and data constraints

Consider optional `projectId` and `sprintId`, tenant-bound foreign keys with strong membership validation, migration/backfill for existing tasks and indexes for filters/date queries. Preserve existing task identifiers and public links. Update task create/item, table columns, bulk actions, Board/Calendar filters, reports, notifications/activity events, import/export and SDK types. Consistency across pages after moves is essential. Avoid reusing legacy task `area` or task `type` fields as a surrogate project without explicit migration policy.

### Board

Preserve drag/drop, columns, WIP limits, keyboard and quick create; use shared task detail full page. Optional fast create in a column is a speed optimization; full-page creation always available for complete task. Show project/sprint context unobtrusively and preserve filters during item-open/back. Project/sprint group/switch options only if supported without confusing status columns.

### Calendar

Expose project milestones/target deadlines, sprint date **ranges**, and task due dates as distinct toggleable calendar layers. Don't draw every project as a band over every day by default. Month should remain legible; timeline/range modes can be a later enhancement. Clicking sprint range/project milestone opens corresponding ItemPage, task opens Task Item. Preserve day/month/list flows, date navigation and works logs. Multiple overlapping sprints need stacking/overflow strategy and legend. Creation from a day can seed appropriate date, then open full-page create.

## Company and personal identity

Company Overview keeps relevant metrics, logo/name/description, company story and **inline** edits with save indicators. Settings is a distinct full-page administrative area with sections for Profile/Branding, Fields/Variables/Vocabulary, Integrations & Email Senders, Team Access, privacy/visibility and other existing company settings. A normal team member might have view-only profile and limited settings. Account avatar is visible globally and opens outside-company profile/settings; don't make user profile dependent on presence in a room or workspace.

## Stream and chat

Keep existing `RoomFloor` and `ChatShell` rather than forcing them through collection/item abstractions. Chat is a collaboration surface, not a substitute for Agents. Make chat rail mode predictable, optionally collapsed for editors; retain recording/media sessions as far as feasible when switching work surfaces. Stream navigation must survive company nav redesign without unexpectedly disconnecting or losing drafts. Media permissions/ownership and user experience need dedicated regression coverage.
