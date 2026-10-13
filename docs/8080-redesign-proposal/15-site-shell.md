# 15 — Shared outer shell

Decision record · 10 October 2026, **revised 12 October 2026** · Firm implementation direction. The revision replaces the planned left navigation with one unified top header (and bottom tabs on phones). Account-level routes already share `AppShell`; Company, Room and Invite still render their own `StageChrome` + `WorkNav` and migrate to the shell.

`00-decisions.md` D10 records the decision and its precedence. D9's collection architecture (title switcher, toolbar, shared table) is unchanged.

## 1. One shell for the whole site

Mount one `AppShell` inside the router and above the route outlet. It owns the header, the phone bottom tabs, the content region, overlay layers, the account menu and the command palette. Navigating between Browse, templates, workspaces, company pages, conversations, invitations and Account never replaces it.

Page components supply content and contextual data. They must not render another masthead, a second navigation bar, a body width rule, or a global footer. Company identity remains distinct from 8080 identity and the person's account.

The same rule applies to loading, not-found, permission, empty and error states. Resolve membership inside the existing shell; do not replace the screen with a differently sized loading page.

## 2. Geometry

| Element | Decision |
| --- | --- |
| Header | Full viewport width, one row: **56px** at 720px and above, **48–52px** below. A large-control theme may raise the shared height token consistently on every route. 1px bottom hairline. |
| Bottom tabs (phones) | Below 720px only: **56–64px** plus `env(safe-area-inset-bottom)`, fixed to the bottom. The content region reserves that height. |
| Content column | The full width under the header. No route-specific outer `max-width` or centred outer container. |
| Content inset | 24px on desktop/tablet; 16px below 720px. The header's left edge, page titles and toolbars share it. |
| Reading/form measure | Inner sections may be limited to 720px, aligned to the same left edge. |
| Wide data and canvases | Fill the content region. Tables, boards and sheets own their horizontal overflow. Never widen the document/body. |
| Scrollbar | Reserve the content scrollbar gutter to avoid shifts when content length changes. |
| Chat | Overlay; never takes width from the content column. |

Only viewport changes, a theme's common sizing rules, or user-entered fullscreen may change outer geometry. Route changes, data arriving, account resolution and opening chat do not.

```text
Desktop (≥ 720px), one 56px row
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣  [W webdegg ▾] │ Home  Data  Board  Calendar  Team     [⌕ Search…  Ctrl K] 🔔 💬 (N)▾ │
│                     ‾‾‾‾                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Contacts  + New contact  Import                                            │
│ [search] [View] [filters…]                              [Columns] [Table|Grid] │
│ Page content                                                    ┌──────────┐ │
│                                                                 │ Chat     │ │
│                                                                 │ overlay  │ │
└─────────────────────────────────────────────────────────────────┴──────────┴─┘

Phone (< 720px)
┌──────────────────────────────┐
│ ▣ [W webdegg ▾]    ⌕ 🔔 💬 (N) │  48–52px
├──────────────────────────────┤
│ Contacts            [+ New]  │
│ [search]          [Filters ▸]│  filters open in a sheet
│ ┌──────────────────────────┐ │
│ │ contact card             │ │  cards, not a squeezed table
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Home  Data  Board  Cal  Team │  56–64px + safe area
└──────────────────────────────┘
```

## 3. Header contents and order

Left to right: **logo mark → workspace switcher → destinations → search → notifications → chat → avatar.**

- **Logo mark** links to `/`. Inside a workspace it is the mark only (no "8080" wordmark); the switcher carries identity.
- **Workspace switcher**: company logo/initial + name + ▾; opens a labelled picker (companies, "Create a company"). Long names truncate visually and keep the full accessible name.
- **Destinations**: `Home · Data · Board · Calendar · Team` (D9). Home = the company page; Data returns to the last list (the title switcher changes it); Team = the company channel. Active = `aria-current="page"` + a 2px signal underline at the header's bottom edge. Icons + labels.
- **Search**: one control that opens the existing Ctrl/Cmd+K `CommandPalette`. Never a second search implementation. List search stays in each list's toolbar.
- **Notifications**: the existing For you inbox (the bell), where supported.
- **Chat**: the only chat entry point (the floating button is removed). Opens the `ChatShell` overlay for the current room / company channel (D4). Hidden where there is no valid chat context.
- **Avatar** menu: account, theme, Get App, sign out. Guests see the sign-in/upgrade control.

**Collapse order as width shrinks** (keep the switcher and destinations visible as long as possible):
1. Search field → search icon button.
2. Notifications and chat keep icons; spacing tightens.
3. Workspace name truncates (min ~96px), then the switcher shows the mark only.
4. Destination labels drop to icons (labels remain as accessible names and tooltips).
5. Below 720px the destinations move to the bottom tabs.

**Who sees what (same shell, controls omitted):** guests and accounts without a company see logo · Browse/Conversations · search · avatar — no switcher, no workspace destinations, no bottom tabs of workspace destinations. In a room linked to a company the viewer belongs to, the company's header shows; otherwise the room shows the account-level header (D8).

## 4. Phones (below 720px)

- **Top bar** 48–52px: logo mark, workspace switcher, search, notifications, chat, avatar.
- **Bottom tabs** 56–64px: the same five destinations, routes and permissions as desktop — one navigation model, two presentations. No hamburger, no drawer.
- Search opens the same command palette (full-screen sheet on phones). Contextual list search remains in the page.
- Page actions: compact primary button; secondary filters collapse into a sheet.
- Lists show cards (D9 phones rule), not a squeezed table.
- The bottom tabs hide while the on-screen keyboard is open and during recording/fullscreen media.

## 5. Scrolling, chat and editors

The shell fills `100dvh`, using a fixed grid for header, content and (phones) bottom tabs. Ordinary pages have one route-content vertical scroller; virtualized tables and canvases may take over the content region's scrolling without adding another surrounding page scroller.

Preserve list filters, sort, selection and scroll through existing route-state mechanisms. Restore scroll on Back; focus the page heading on deliberate page navigation, not on filter/query changes. A skip link focuses the content region.

The chat panel is an overlay within the content region, opened from the header's chat control. At desktop widths it is up to 400px wide; on phones it is a full-height sheet above the bottom tabs. Opening and closing never resizes the page. Keep each room's history separate; preserve company-channel context and joining rules. When chat lacks a valid context, hide the control rather than render a fictitious channel.

Chat's Maximize action fills the content region and keeps the header. A true fullscreen media/editor mode is an explicit user action with a visible exit and Escape restoration. Preserve mounted recording/editor state while changing layout.

## 6. Implementation work

1. One `AppHeader` (replacing the `StageChrome` masthead and the horizontal `WorkNav` bar) plus `BottomTabs`, both rendering one destination list (`sections.ts`). Reuse `WorkNav`'s destination and remembered-list logic; do not create a second navigation model.
2. Mount the header in `AppShell` and move Company, Room and Invite under it; retire their own `StageChrome`/`WorkNav` rendering.
3. Move Theme and Get App into the avatar menu (`AccountSheet`); remove the masthead's duplicate controls and `WorkNav`'s search box.
4. Remove the floating `room-chat-toggle`; the header's chat control opens `ChatShell`.
5. Remove obsolete `.masthead`, `.work-nav` and route-specific outer rules as each owner migrates. Do not compensate with another stack of overrides.

## 7. Acceptance gate

- Navigate Browse → template → Your workspaces → Company → Data → task → Account → room. Header height and content start remain identical at a fixed viewport/theme.
- At 1728, 1440, 1280, 1024 and 768px the switcher and all five destinations stay visible; search collapses first.
- At 390px: top bar + bottom tabs, same destinations and active state as desktop; no horizontal page scroll.
- Measure content bounding boxes before/after slow membership loading, empty/error states, opening/closing chat and changes in page length. No unrequested shifts.
- Verify tab order, active labels, focus restoration, topmost Escape handling and touch operation. Nothing only on hover.
- Preserve Back state and unsaved edits, recording/playback, room invitations, public guest access and workspace access boundaries.
- Check 390, 768, 1024, 1440 and 1920px in dark, light, retro-terminal and ultra-large; include zoom and reduced motion.

This decision record changes the build contract. It does not claim the current application already has a unified header.
