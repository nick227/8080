# 15 — Shared outer shell

Decision record · 10 October 2026 · Firm implementation direction. Catalog, Reader, Workspaces, Rooms, workspace creation and Account now share the promoted AppShell in the working tree. Company and individual room route migration remains pending.

This follows the user's decision to adopt the directory's header and left navigation across 8080. It supersedes earlier recommendations against a persistent left navigation, and supersedes route-specific outer layouts. It preserves D9's collection architecture and navigation destinations. `00-decisions.md` records that precedence.

## 1. One shell for the whole site

Mount one `AppShell` inside the router and above the route outlet. It owns the header, left navigation, content region, overlay layers, account menu and command palette. Navigating between Browse, templates, workspaces, company pages, conversations, invitations and Account never replaces it.

Page components supply content and contextual navigation data. They must not render another masthead, outer sidebar, body width rule, or global footer. Global account and navigation controls stay in the same positions. Company identity remains distinct from 8080 identity and the person's account.

The same rule applies to loading, not-found, permission, empty and error states. Resolve membership inside the existing shell; do not replace the screen with a differently sized loading page.

## 2. Geometry

| Element | Decision |
| --- | --- |
| Header | Full viewport width; 72px at 768px and above, 64px below. A large-control theme may increase the shared height token consistently across all routes. |
| Expanded left navigation | 240px including padding and border. |
| Compact left navigation | 64px; recognizable destination icons with accessible names and hover/focus tooltips. |
| Content column | All remaining width. No route-specific outer `max-width` or centered outer container. |
| Content inset | 24px on desktop/tablet; 16px below 768px. Same title and toolbar left edge on every page. |
| Reading/form measure | Inner sections may be limited to 720px, aligned to the same content left edge. A document's paper may be centered inside its editor canvas. Neither changes the shell. |
| Wide data and canvases | Fill the content region. Tables, boards and sheets own their horizontal overflow. Never widen the document/body. |
| Scrollbar | Reserve the content scrollbar gutter to avoid shifts when content length changes. |
| Chat | Overlay by default; never automatically takes width from the content column. |

The title, toolbar and content have stable start positions. Directory cards can reflow to fit the available column; the column itself does not acquire a different width policy. Switching from a collection to a detail page does not recenter the whole page.

Only viewport changes, a theme's common sizing rules, explicit nav collapse/expand, or user-entered fullscreen may change outer geometry. Route changes, data arriving, account resolution and opening chat do not.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Nav toggle  8080           Go to…                   Notifications Account│
├───────────────┬──────────────────────────────────────────────────────────┤
│ Browse        │ Page title / collection selector            Page actions│
│ Your spaces   │ Local search and filters / view controls                 │
│ Conversations │                                                          │
│               │ Page content                                             │
│ Workspace     │                                                          │
│ Company       │                                               ┌────────┐│
│ Lists         │                                               │ Chat   ││
│ Board         │                                               │overlay ││
│ Calendar      │                                               └────────┘│
│ Stream        │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
```

## 3. Collapse and expand are always available

A permanent button at the top left of the header controls navigation. It is outside the collapsing region, remains visible in every state, and is keyboard reachable. Use `aria-controls`, `aria-expanded`, and the current action as the accessible name.

| Viewport | Effective navigation | Toggle behavior |
| --- | --- | --- |
| 1200px and wider | Expanded by default; honor the viewer's expanded/compact preference. | Collapse navigation / Expand navigation. Both change the content width deliberately. |
| 768–1199px | Compact rail regardless of the wide-screen preference. | Open navigation as an expanded overlay, then Close navigation. Opening it does not shrink the page. |
| Below 768px | Off-canvas drawer, closed by default; no permanent rail. | Open navigation / Close navigation. No content reflow. |

Persist only the viewer's wide-screen preference (`8080.nav.mode = expanded | compact`); keep a memory fallback if storage fails. Read it before shell paint. Breakpoint changes must not overwrite the preference. Returning to a wide viewport restores it. Overlay openness is temporary and is not restored on reload.

In compact mode, all destinations remain reachable; workspace selection opens a labeled picker. No hover-only navigation and no thin invisible resize handle as the only way to restore the sidebar. When focus is on a control that will disappear, move focus to the header toggle before collapse.

The drawer traps focus, makes the covered application inert, closes on Escape, outside click, or successful navigation, and restores focus to the trigger unless a newly navigated page takes focus. Closing an account menu inside the drawer must not also close unrelated layers. Handle Escape from the topmost layer outward.

Do not animate horizontal page width. Nav overlays may use a short opacity transition, respecting reduced motion.

## 4. Header and navigation contents

**Header:** nav toggle and 8080 Home link; a stable `Go to…` command control; existing notifications where supported; account/sign-in control. Theme selection lives in the account/preferences menu, with guest access retained. Site-level Create workspace lives in the left nav and relevant pages. Record creation remains in the page header.

`Go to…` initially opens the existing navigation command palette. Do not present it as a universal record search until the backing search is implemented. Directory search moves into the directory toolbar, in the same content area as list searches. This gives the header one meaning across all pages without losing directory filtering.

**Global nav group:** Browse, Your workspaces, Conversations, Create a workspace. These destinations do not rearrange on workspace entry.

**Workspace group:** workspace identity/switcher, Company, Lists, Board, Calendar, Stream. Move those destinations from the current horizontal `WorkNav` into the shared left nav. Do not retain duplicate horizontal workspace navigation. Preserve Lists' last-list behavior and the shared collection title switcher. Preserve D9's local list search, filters, Views and Columns controls.

Inside a workspace route, this group reflects its authorized workspace. At the account-level directory, the last valid workspace may appear as a labeled shortcut; this does not make Browse a company-owned page. Guests do not see private workspace destinations. In rooms, use existing company-link/membership rules; a linked company never becomes visible just because a room is public.

Long workspace names truncate visually with full accessible names. Late membership data may populate the navigation group but cannot resize the rail. Active navigation distinguishes global Browse from a workspace's current destination.

## 5. Scrolling, chat and editors

The shell fills `100dvh`, using a fixed grid for header and body. Navigation and route content scroll independently. Ordinary pages have one route-content vertical scroller; virtualized tables and canvases may take over the content region's scrolling without adding another surrounding page scroller.

Preserve list filters, sort, selection and scroll through existing route-state mechanisms. Restore scroll on Back; focus the page heading on deliberate page navigation, not on filter/query changes. Anchor links target the content scroller. A skip link focuses the content region.

The right chat panel is an overlay within the content region, with a persistent Show chat action on eligible routes. At desktop widths it is up to 400px wide. At narrow widths it becomes a content-sized overlay. Open and Close never resize the left rail or underlying page. Keep each room's history separate; preserve company-channel context and joining rules. When chat lacks a valid context, keep the saved preference but do not render a fictitious channel or join automatically.

Chat's Maximize action fills the content region and keeps site navigation available. A true fullscreen media/editor mode is an explicit user action with a visible Exit fullscreen control and Escape restoration. It never persists a hidden-nav state into other routes. Preserve mounted recording/editor state while changing layout.

## 6. Implementation work

1. Build `AppShell`, `AppHeader`, `AppNavigation`, and shell preference state using existing tokens and controls. Add a route-outlet contract for page metadata, workspace context and chat availability.
2. Move shell ownership above the keyed routes in `app/routes.tsx`. Keep intentional room/company remount boundaries inside the outlet; nav and header remain mounted.
3. Migrate Home, Workspaces, NewWorkspace, Account and Invite. Retire their `ProductLayout`/`StageChrome` outer wrappers after parity.
4. Migrate Company, its Lists/Board/Calendar/Stream, and then Room/recording. Replace `WorkNav` presentation while keeping its destination/remembered-list logic.
5. Move `ChatShell` presentation into the shared overlay layer; preserve existing data, streams, posting, joining, and maximize/restore behavior.
6. Remove obsolete `.shell`, `.room-shell`, `.product-main`, and directory-specific outer-width rules as each owner migrates. Do not compensate with another stack of CSS overrides.

## 7. Acceptance gate

- Navigate Browse → template → Your workspaces → Company → Lists → task → Account → room. Header height, rail width and content start remain identical at a fixed viewport/theme/nav state.
- Collapse, navigate, reload, expand: the rail restores every time; the header toggle never disappears.
- Resize wide → tablet → phone → wide: restore the original wide-screen preference, never persist the forced narrow state.
- Measure content bounding boxes before/after slow membership loading, empty/error states, opening/closing chat and changes in page length. No unrequested shifts.
- Verify tab order, active labels, focus restoration, topmost Escape handling, and touch operation. No feature is accessible only on hover.
- Preserve Back state and unsaved edits, recording/playback, room invitations, public guest access and workspace access boundaries.
- Check 390, 768, 1024, 1440 and 1920px in dark, light, retro-terminal and ultra-large; include zoom and reduced motion. Theme changes may change common sizes, never route-specific ones.

This decision record changes the build contract. It does not claim the current application already has a unified shell.
