# 03 — Shared page contracts, collections, items and editors

## Principle: share interaction architecture, not all screens or data

A unified table platform can make five Manage and three Work collections consistent while keeping separate schemas, permissions, cache keys, item lifecycle and specialized editors. **Do not create a generic `Record` table, universal mutation endpoint or bloated domain abstraction.** Standard UI contracts must remain composable and thin.

## 0. Global `AppShell` (the only owner of universal chrome)

Responsibilities: company identity/menu, nav selection, global search/command launch, notifications, prominent avatar, chat panel mode and app-wide feedback. Content surfaces must not render additional global nav. Shell declares content/immersive mode, width and overflow policies; it doesn't know individual domain fields. Offer editor focus mode that optionally collapses chat/nav but preserves easy recovery.

## 1. `CollectionPage` shape

```
Collection header:  [Type icon] [Title] [count/optional summary]    [New {singular}]
Collection toolbar: [Search] [Filter] [Sort] [Columns] [View presets] [More]
Filters/selection:  active chips OR contextual bulk toolbar (not both needlessly)
Collection data:   shared Table / optional grid (domain columns + cell renderers)
Status/footer:     pagination/virtualization, loading, errors, last sync where relevant
```

Core behavior: stable row identity; keyboard nav/accessibility; click row opens **full item page**; optional in-row atomic changes without conflicting with row-open; sort, filter, search, column show/hide/reorder/resize, density, bulk select/actions, empty/error/loading, URL/persisted prefs, overflow and export if already supported. Multiple data sources retain their existing loading/caching contracts. Use feature flags to stage migration.

Allow group/section presets for Documents, time/report presets for Tasks, and domain chips without multiplying toolbars. A collection doesn't need every capability; controls only render if supported, but where supported they occupy standard slots. If a dataset has no sortable field, do not render fake sort.

Table component must support optional single-line/multiline cells, truncation with full accessible details, status, avatar/presence, dates and prices; sticky header and virtualization only when they improve real performance. Preserve selected rows across page loads only as domain semantics allow; clear selection predictably when filter changes.

## 2. `ItemPage` shape

```
Back trail:     [Collection] / [Item]   optional Prev / Next and Copy Link
Identity:       icon/avatar + title + concise metadata + status    [Primary action] [More]
Body:           domain primary content                            Properties / links
Sections:       details, related objects, work, files, activity/history
Special mode:   full-screen editor for rich content with same identity/back navigation
```

Uniform conceptual slots: `identity`, `summary`, `properties`, `main`, `relationships`, `activity`, `actions`, optional `editor`. Not every item must show all slots. Layout responds to width: sidebar properties become collapsible sections below content on narrow screens; don't nest scroll regions arbitrarily. Item is directly linkable; back restores collection state. No preview-first slideout as the primary interaction. Inspectors may exist for atomic convenience, not as sole editing mode.

**Entity mapping**:

| Domain item | Main content | Properties / relationships | Activity/editor |
|---|---|---|---|
| Task | title, description, checklist, work logs, dependencies | project, sprint, status, priority, assignee, dates | task events + links |
| Project | goal, description, progress, milestones, task list | owner, dates, members, linked documents | timeline and tasks |
| Sprint | goal, task planning, progress, commitment | timebox, status, assignments, project mix | completion summary and historical changes |
| Contact | CRM brief, notes, media, follow-ups | stage, owner, tags, related tasks/agents | interaction history |
| Inventory | description, media, stock overview | price, categories, stock/availability | adjustments/history |
| Team membership | member identity, presence, active focus and assigned work | role, company position, permissions (authorized) | accomplishments |
| Document | metadata, collaboration state, editor | owner, links and document type | edits/versions where supported |
| Agent | status, purpose, next run, health | channel, sender, audience, trigger | email/chat editor and delivery events |

## 3. `CreatePage` is an ItemPage in create mode

Dynamic `New {Entity}` action navigates to full-page create. Same visual anatomy as edit, with blank/default properties, clear required fields, cancel/back behavior, validation and intentional save. Simple inline creation may remain *as accelerator only* on Board or Calendar if it does not replace full-page create for substantive work. Never require a modal for creating an entity with multiple concerns. Preserve existing import flows, but give multi-step imports a full-page flow when substantive.

Modal/popover decision rule: acceptable for rename, one-property change, date picker, confirmation, share/copy, recipient quick selection when truly simple; replace for agent editing, full-contact editing, document creation where options matter, complex audience building, task creation, company-wide settings and multi-step import. `StockAdjust` may stay compact if it is a focused, transaction-like operation with reliable confirmation/history.

## 4. `EditorPage` specializations

Documents and agent messages receive dedicated full-width editing surfaces. They still inherit Item header/back/identity/save state. Editor-specific toolbars and panes are owned by the editor, not app shell. Preview resize, split orientation, mobile alternative, autosave reliability and conflict recovery need deliberate design; no use of modal as the primary editing surface.

## 5. Specialized canvases

- **BoardCanvas**: task column drag/drop, keyboard drag equivalents, WIP limits, backlog and fast task open. Project/sprint context in shared Work toolbar; maintain per-view filters where sensible.
- **CalendarCanvas**: date navigation, day/month/list, sprint date bands, milestones and optional project range overlays. Layer toggles guard against clutter; calendar navigation is not the same as table toolbar.
- **StreamCanvas**: participant/video, record/playback, focus modes, chat and presence. Uses shell context but retains spatial freedom and media performance.

## 6. Prototype API contracts (illustrative, not exact implementation)

```ts
interface CollectionDefinition<T> {
  id: string;
  title: string;
  singularLabel: string;
  getKey(item: T): string;
  columns: CollectionColumn<T>[];
  capabilities: { create?: boolean; bulk?: boolean; grid?: boolean; export?: boolean };
  // Adapter owns data, authorization, mutations, filters and URL parsing.
  useData: () => CollectionData<T>;
  openItem: (item: T) => void;
  create: () => void;
}
interface ItemDefinition<T> {
  kind: string;
  useItem: (id: string) => ItemData<T>;
  getIdentity: (item: T) => ItemIdentity;
  // React slots: properties, content, activity, related, optional editor.
}
```

Do not prescribe hooks declared in dynamic data objects if they violate Rules of Hooks; actual architecture should use stable component adapters or hooks invoked in fixed components. Avoid passing huge arbitrary config objects into deeply coupled generics. Prefer composition and typed domain adapters. Keep server-side filtering/sorting authoritative when the existing endpoint supports it.

## 7. UX shape governance

Provide component showcase stories/examples and written contracts for `PageHeader`, `ContextToolbar`, `CollectionTable`, `ItemHeader`, `PropertyField`, `ActionMenu`, `ActivityTimeline`, `FormField`, `SaveStatus`, `EmptyState`, `ErrorState`, `FocusMode` and optional `QuickNav`. Ban ad-hoc headers and arbitrary page-scoped button variants unless an exception is documented. Each layout element has one owner.
