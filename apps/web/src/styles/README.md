# CSS themes

Import `globals.css` once. It loads `tokens.css` (default inputs) and `themes.css`
(presets), `controls.css` (button/input/form tokens), and `layout.css` (shared layout recipes), then defines derived colors and global styles. Feature CSS consumes
these variables and should not define application-wide palette values.

The existing dark appearance is the default. Set `data-theme="light"` or
`data-theme="dark"` on `<html>` to select a preset. The header selector saves the choice in browser storage (`8080.theme`) and syncs
it across tabs. The saved selection is applied before React mounts. System-theme
detection is not enabled; unknown or removed theme IDs fall back to dark.

```js
document.documentElement.dataset.theme = 'light'
```

A container can also have `data-theme`, including nested light/dark previews.
Each boundary resets to the complete default token set before applying its
preset; derived colors are recalculated there, rather than inherited from the
parent. Portals outside a themed container use their destination's theme. For a
whole application, use the attribute on `<html>`.

## Custom themes

Load overrides after `globals.css`, or add a preset to `themes.css`:

```css
[data-theme="brand"] {
  --color-scheme: light;
  --bg: #faf8f2;
  --panel: #fff;
  --ink: #232923;
  --muted: #60685f;
  --line: #d4dbd1;
  --signal: #286043;
  --danger: #b52b24;
  --surface-deep: #e8ede4;
  --surface-subtle: #f1f4ed;
  --surface-tile: #fff;
  --surface-desk: #e0e6dc;
  --surface-active: #d7dfd2;
  --sans: system-ui, sans-serif;
  --radius: 6px;
  --focus-color: var(--signal);
}
```

Override inputs on the theme boundary itself. For an arbitrary local override,
mark that element with `data-theme="custom"` so aliases such as `--surface-hover`
and `--line-strong` are recalculated against the new inputs. Inline CSS custom
properties work too. Derived tokens can also be overridden directly on the same
element. The defaults use `:where()` so ordinary selectors win without
`!important`.

- `--bg`, `--panel`, `--surface-*`: UI backgrounds and interaction surfaces.
- `--ink`, `--muted`, `--line`, `--signal`, `--danger`: content and state colors.
- `--media-*`, `--paper-*`, `--paper`: independent media and document palettes;
  these deliberately retain their defaults in light mode.
- `--shadow-color`: shadow pigment, independent of themed UI backgrounds.
- `--text-*`, `--tracking-*`, font families: shared typography.
- `--space-*`, `--radius*`, `--line-width*`: spacing and border treatment.
- `--motion-*`, `--ease-out`: motion; reduced-motion preferences zero durations.
- `--focus-color`, `--focus-offset`: default keyboard focus treatment.

Layout geometry, content-selected map colors, and inline component styling are
not a complete theme API. Check contrast when supplying a custom palette,
especially for muted text, state colors, and controls drawn over imagery.

Run `pnpm --filter web test:theme` to check real-browser theme inheritance,
scoped overrides, light/dark switching, and reduced-motion tokens. This check
uses local styles only and needs Playwright Chromium installed.

## Density and component sizing

Density is independent of color themes:

```html
<html data-theme="light" data-density="compact">
```

Use `compact` (0.8), `comfortable` (1, the existing default), or `spacious` (1.2).
A nested `data-density` container changes spacing without resetting colors or
fonts. Density inherits through nested theme boundaries. Custom factors work on
`<html>`, a theme boundary, or an element marked `data-density="custom"`:

```css
[data-theme="brand"] {
  --density: 0.9;
  --table-row-height: 40px;
  --table-cell-padding-x: 18px;
  --control-size: 36px;
  --chat-panel-width: 420px;
  --radius-card: 12px;
}
```

The spacing scale is calculated from `--density`, clamped to 0.75–1.5. Control
and row tokens have minimum sizes; the large secondary controls remain at least
44px and recording controls at least 88px. Direct component overrides are exact
values and bypass those defaults. Typography does not shrink with density.

| Area | Tokens |
| --- | --- |
| Shared spacing | Existing `--space-*`, plus `--space-between`, `--space-section`, `--space-fields`, `--space-2xl`, `--space-3xl`, `--space-4xl` |
| Controls | `--control-size-sm`, `--control-size`, `--control-size-lg` |
| Navigation and toolbars | `--mast`, `--work-nav-height`, `--toolbar-height`, `--toolbar-height-lg` |
| Document list table | `--table-row-height`, `--table-header-height`, `--table-cell-padding-x` |
| Lists and feed cards | `--list-row-padding-x`, `--list-row-padding-y`, `--item-padding` |
| Calendar | `--calendar-day-height`, `--calendar-day-height-mobile`, `--calendar-slot-height`, `--calendar-dialog-width` |
| Panels | `--chat-panel-min-width`, `--chat-panel-width`, `--reply-panel-width`, `--panel-padding` (reply body), `--explorer-max-width` |
| Recording | `--record-size`, `--record-size-mobile` |
| Shape | `--radius-card`, `--radius-notice`, `--radius-node`, existing `--radius*` |

Set specific spacing and component overrides on each boundary where they are
needed: boundaries recompute these defaults using the inherited density, so a
parent's individual `--space-*` override is not copied into a nested boundary.
Panel widths and radii are independently themeable and do not scale with density.
Responsive layouts still take precedence (for example, mobile panels fill the
available width). Media dimensions, graph coordinates, paper dimensions, inline
styles, and JavaScript-controlled spreadsheet row geometry are not scaled by this
CSS density API.

## Typography, state, and media details

Themes can override `--weight-light`, `--weight-normal`, `--weight-medium`,
`--weight-bold`, and `--weight-heavy`, plus shared `--leading-heading`,
`--leading-content`, `--leading-body`, and `--leading-relaxed` line heights.
The larger shared text sizes are `--text-2xl`, `--text-3xl`, `--text-title`, and
`--text-display`. Fluid editorial headings and icon sizes retain their own sizing.

`--opacity-disabled` controls the standard disabled state; controls with distinct
busy, selected, or media-fade behavior retain their own values. Calendar inputs
use the shared `--focus-color` with `--focus-offset-tight`.

`--media-label-ink` and `--media-label-bg` form an independent foreground/background
pair for labels and controls over dark media. Their derived overlay and border
tokens keep these labels readable when the surrounding page switches to light.
Override the pair together when customizing media treatment.

The browser check also audits CSS variable references and rejects hard-coded
hex/RGB colors in feature styles. It checks that response thumbnail rows remain
on one line at spacious density and that typography, disabled-state, and focus
customizations reach actual controls.


## Adding themes to the header selector

1. Add a `[data-theme="your-stable-id"]` preset in `presets/your-stable-id.css`
   and import it at the top of `themes.css`. The attribute selector intentionally
   outranks the low-specificity default aliases, allowing component/layout tokens
   as well as palette inputs to be overridden.
2. Add `{ id: 'your-stable-id', label: 'Display name', group: 'Collection' }` to
   `src/theme/registry.ts`. Keep IDs stable because they are saved preferences.
3. Run `pnpm --filter web test:theme` and `pnpm --filter web test:theme-switcher`.

The registry derives valid IDs, runtime validation, and grouped dropdown options.
Use unique IDs and concise labels; registry order controls collection/option order.
The native select provides keyboard navigation and type-to-jump through long lists.
No switcher component or persistence changes are needed to add a theme. Themes
should override the token inputs documented above rather than add component-specific
rules. A theme must have both its CSS preset and registry entry before exposing it.

The selector uses `--theme-select-width` and `--theme-select-width-mobile` for its
closed width. Its accessible name remains “Theme” when the visible label is hidden
on small screens. Storage failures still allow selection for the current tab.

## Buttons, fields, and forms

See [the control token reference](./CONTROLS.md) for dedicated button/input state
and appearance tokens, form layout/labels, variant behavior, and opt-in recipes
for new components. Defaults are organized in `controls.css`, imported by the
global stylesheet.


## Shared layouts

See [the layout reference](./LAYOUT.md) for responsive page gutters, content-width
presets, shared toolbar/panel recipes, and the existing pages connected to them.


The [preset catalog](./PRESETS.md) describes the 15 additional themes. Run
`pnpm --filter web test:theme-gallery` to cycle through every registered option
with desktop/mobile layout, contrast, and reduced-motion checks. Set
`THEME_SCREENSHOTS=/tmp/theme-previews` to also capture each theme for visual review.
