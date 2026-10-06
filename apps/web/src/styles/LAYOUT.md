# Shared page, toolbar, and panel layouts

`layout.css`, imported by `globals.css`, owns shared structure and semantic layout
tokens. Existing features use grouped selectors for these recipes; new components
can use the `layout-*` classes directly.

## Theme controls

```css
[data-theme="brand"] {
  --page-gutter: 32px;
  --page-gutter-mobile: 16px;
  --page-padding-block: 28px;
  --section-gap: 32px;
  --content-width-standard: 1080px;
  --content-width-wide: 1440px;
  --toolbar-gap: 12px;
  --panel-width: 360px;
  --panel-padding: 24px;
}
```

Declare overrides on the theme/density boundary. Derived layout values recompute
there. Default spacing follows density; content and panel widths do not.

| Concern | Tokens |
| --- | --- |
| Page edges | `--page-gutter`, `--page-gutter-mobile` |
| Page rhythm | `--page-padding-block`, `--page-padding-bottom` (lobby bottom clearance), `--section-gap` |
| Width presets | `--content-width-narrow` (480px), `--content-width-standard` (1120px), `--content-width-wide` (1280px), `--content-width-media` (960px) |
| Toolbars | `--toolbar-padding-x`, `--toolbar-padding-y`, `--toolbar-gap`, existing `--toolbar-height`, `--toolbar-height-lg`, `--work-nav-height` |
| Panels | `--panel-width`, `--panel-padding`, `--panel-header-height`, `--panel-header-padding-x`, `--panel-body-gap`, `--panel-footer-padding-x`, `--panel-footer-padding-y`, `--panel-footer-gap` |
| Card grids | `--card-grid-min-width`, `--card-grid-gap` |

`--page-gutter-current` is derived from the desktop gutter, switching to the mobile
gutter at 720px. Override the two input tokens rather than this derived value.
`--toolbar-padding-x` defaults to the current page gutter. Footer bottom padding
adds the device safe-area inset.

## Pages

```html
<main class="layout-page" data-width="wide">
  <div class="layout-stack">…</div>
</main>
```

Widths include horizontal padding and are capped by the parent. Omit `data-width`
for standard width, or choose `narrow` or `wide`. Set `--layout-page-width` directly
on a particular container for a local exception.

The lobby uses standard width and the explorer uses wide width. Both use the
same page gutter, including on mobile. The masthead also follows that gutter.
Lobby sections and explorer sections use the same section gap. Directory cards
fit their container even when it is narrower than the preferred card width.
The reading shell follows narrow width; room shell overrides still allow its
full-width workspace. Room media stages use the media-width token.

Compatibility: `--explorer-max-width` remains an override for the explorer alone
and defaults to `--content-width-wide`.

## Toolbars

```html
<div class="layout-toolbar" data-size="large">
  <h2>Title</h2>
  <div class="layout-toolbar-actions">…</div>
</div>
```

Work navigation, work toolbars, and calendar toolbars share horizontal padding,
gap, alignment, and separator rules. Their heights remain appropriate to their
contents. Calendar toolbars can wrap on small screens. Navigation remains
horizontally scrollable; compact work bars retain zero vertical padding. Generic
and calendar toolbars use `--toolbar-padding-y`.

## Panels

```html
<aside class="layout-panel">
  <header class="layout-panel-header">…</header>
  <div class="layout-panel-body">…</div>
  <footer class="layout-panel-footer">…</footer>
</aside>
```

Reply and edit sheets share the panel structure, padding, non-shrinking headers
and footers, and scrollable body. Their positioning, animations, header content
alignment, and mobile bottom-sheet behavior remain feature-specific. The generic
recipe does not position itself or assume a fixed viewport height.

`--reply-panel-width` and `--edit-panel-width` default to `--panel-width` and can
still be overridden independently. Responsive bottom sheets use full width.

Calendar grids, graph coordinates, spreadsheet geometry, document paper sizes,
room split layout, and feature breakpoints remain specialized. These recipes
standardize surrounding layout, rather than imposing one layout on every tool.

`pnpm --filter web test:theme` checks shared gutters, content-width overrides,
section spacing, both panels, mobile behavior, and narrow card grids in Chromium.
