# 10 — Theme compatibility and commercial polish: release gate

**Binding requirement: all current 8080 themes and density variants must keep working exactly as selectable, persistent user preferences.** This is a theme-agnostic redesign, not a fixed light/dark redesign. A bright mockup does not mandate its palette, radii, shadows or fonts.

## Before editing CSS

1. Inventory actual theme IDs, accents, density settings, persistence, CSS variables, selectors, layout recipes and portal styling from the repository's current HEAD. Record existing theme screenshots.
2. Create a theme/density **component state gallery** for table, toolbar, item, form, status, popup, dropdown, menu, dialogue, navigation, editor, board, calendar and Stream controls.
3. Define semantic tokens for surfaces, typography, borders, interactive states, focus, selection, semantic status, gaps, radii, shadows and timing. Map *every* current theme; don't hardcode colors in new cross-theme components.

## Non-negotiable visual behavior

- Every existing selectable theme and density setting persists across refresh and navigation and remains supported.
- Work/Manage navigation, all tables, item/create pages, Company edit/settings, avatar/profile, Agents editor and live preview, rich Documents editors, Board, Calendar, Stream and notification/command surfaces render legibly across every theme.
- Popovers, portals, nested dialogs, drag overlays and tooltips receive correct theme tokens even when rendered outside main app hierarchy.
- UI theme **never silently changes the email's own template/theme HTML**, company logo brand configuration or user data. Email preview uses a neutral sandboxed region.
- Clear focus-visible, contrast, hover/active/disabled/error/warning/success/selection states; respect high-contrast settings, 200% zoom, reduced motion and keyboard navigation. Spacing/density may vary but hierarchy and actions remain stable.
- No full-page horizontal scroll at typical desktop sizes; explicitly scrollable data tables are allowed. Responsive layouts adapt at 390, 768, 1024, 1440 and 1920 CSS px.

## Regression matrix and evidence

Generate test matrix from **actual** theme IDs × density choices × representative viewport widths; automatically take before/after visual snapshots and inspect two most visually dissimilar themes during every feature migration. Cover: Work table/Board/Calendar/Project/Sprint, Manage five collections and their item/create pages, Company and account, Automations Email Studio, Stream, search/menus/dialogs, validation/loading/empty/error states. Include theme switching while unsaved edits exist to confirm drafts, filter state and editor context persist. Add keyboard-only and zoom checks. Theme regressions block release; no “fix after launch” exception.

## Quality bar

Consistency and beauty derive from typography rhythm, spatial hierarchy, predictable field/actions, table density, aligned headers, unobtrusive motion and confident empty/error states. Do not flatten expressive user-chosen themes into one generic aesthetic.
