# 04 — Theme-agnostic design system and native-studio interaction quality

## Design qualities

Beautiful by **composition**: readable typography, aligned controls, meaningful whitespace, clear focal point, deliberate information density and restrained motion. Each theme can express its own color, font flavor, icon style, borders/radii/shadows, but must meet structure, hierarchy, contrast, state and accessibility contracts. A retro/mono theme must not force all body text into tiny monochrome metadata styling.

## Tokens: semantic first

Review existing `styles/globals.css`, `styles/layout.css`, `styles/controls.css`, then extend semantic roles rather than introduce raw values in each feature CSS:

- **Layout:** `--app-header-height`, `--page-gutter`, `--content-width-readable`, `--content-width-wide`, `--toolbar-height`, `--detail-properties-width`, `--chat-panel-width`; full-bleed Board/Calendar/Stream.
- **Spacing:** 4px base rhythm with e.g. 4/8/12/16/24/32; density modifies spatial tokens without moving controls to different meaning.
- **Type:** three main hierarchy levels: page title, section title, body, then metadata; default body typically 13–15px, accessible legibility in every theme. Tabular/mono for IDs and counts only where suitable.
- **Surfaces:** background, raised, overlay, selected, hover, active, focus; prefer gentle surface separation over colored outlines around everything.
- **Actions:** primary, secondary, subtle, destructive, disabled, busy; semantic foreground/background tokens; visible keyboard focus separate from hover.
- **Feedback:** info, warning, error, success, live/syncing; don't rely on color alone.
- **Motion:** duration short 100–150ms, medium 150–220ms, long <=300ms where necessary; input feedback instantaneous. `prefers-reduced-motion` respected.

These are starting ranges, **not fixed universal CSS**. Measure current scale and validate against themes. Avoid arbitrary typography/radii dictated by one theme.

## Interaction rules (normative)

1. **Responsive input response**: show pressed/selection immediately; use optimistic mutation only with safe rollback/error and concurrency control. Network failure visible and recoverable.
2. **Navigation**: changing collection preserves its filters, sort, scroll, optional selection and recent view. Browser Back restores page state; deep-link to item works without prior client context. No entire-app fade animations on every action.
3. **Keyboard**: `/` or command search only when not editing; `Cmd/Ctrl+K` command launcher; arrow/home/end row navigation when focus is in grid; `Enter` opens selected item; `Escape` closes transient popover; `Cmd/Ctrl+S` saves only if editor defines save action. Shortcuts documented and non-conflicting with assistive tech.
4. **Table**: sticky accessible headings, row focus, selection, multi-select, keyboard bulk actions, column controls, overflow and horizontal scrolling in correct container. Distinguish row click from inline action buttons and text selection. On mobile, responsive list alternative if the dense table isn't usable—same collection contract.
5. **Item editing**: inline low-risk fields can autosave with saving/saved/error badges; substantial content uses robust draft/save/publish semantics. Do not navigate away and discard dirty content silently. Creation and editing use full pages. Focus stays predictable after save/error/back.
6. **Popovers/modals**: focus trap when modal, proper labeling, keyboard dismissal, focus restore, no arbitrary nested sheets. Modals only for trivial operations or confirmations. Full page for complex work.
7. **Undo and feedback**: reversible archive/status/row edits get undo when feasible; destructive actions clearly differentiated. A single shared notification/feedback pattern prevents toast floods.
8. **Panel mechanics**: chat can close/restore/full; preserve mode independently of item navigation. In editor focus mode suppress competing rail space while keeping a visible way back. Resize only if usability tests justify; persist deliberate width.
9. **Motion**: transitions indicate origin and continuity; do not block pointer interactions while waiting. Reduced motion collapses transitions; no layout jitter due to asynchronous metrics or media loads.
10. **Loading**: skeletons only where stable geometry is known; avoid blank pages, stale-success indicators and misleading optimistic confirmation. Offline/reconnecting/conflict states have clear recovery.
11. **Accessibility**: WCAG AA target for contrast, accessible names, keyboard focus order, landmarks, status/live regions, hover equivalents, drag alternatives, target sizing, forms/validation; test with screen reader and high zoom. Respect color scheme/high contrast as appropriate.
12. **Performance**: measure UI response, data waterfall, long tables and large editor preview. Debounce search thoughtfully, cache per collection, avoid duplicate provider loads, virtualize only measured hotspots, keep media rendering isolated from unrelated table rerenders.

## User journeys to benchmark

A. From Company → Contacts search → Contact Item edit → task link → Work task → Back: no lost filters, clear identity context, saved feedback.

B. From Manage → Agents → New → choose prefab → compose/design email → set recipients → schedule/trigger → test to explicit address → review → publish → inspect history: no confusing sender versus recipient, no unsaved data loss, no duplicate send.

C. From Work Tasks → filter Project/Sprint → Board reorder → Calendar verify dates/ranges → task detail: task identity and filter context remain consistent.

D. From Team roster → Member Item → global Account avatar → personal profile → back to company: user and team ownership never conflated.

E. From Stream with chat open → Document editor focus → return Stream: media state and chat are preserved within reasonable resource policy.

## Quality bar / performance targets

Proposed **test budgets**, to be profiled, not existing measurements: local interaction acknowledgment within one animation frame where practical; dropdown/panel transitions ~100–220ms; navigation should not wait for full network fetch before showing route/context; meaningful empty/loading state immediately; no unbounded input lag when table has hundreds/thousands of rows. Measure p50/p95 key actions on development and representative production-like devices. Do not claim strict server SLA without instrumentation.

## Visual QA matrix

Themes: default dark, default light, most retro/monospaced theme, radically different design theme. Viewports: ~390 / 768 / 1024 / 1280 / 1440 CSS px. Density modes if supported. Data: empty, one item, hundreds, long names, unexpected nulls, error/offline; permissions: owner, regular member, unauthenticated. Test browser zoom 200% and reduced-motion; monitor contrast, sticky headers, button hit areas, scroll containment and badge/status semantics.
