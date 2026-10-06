# Button, input, and form theme tokens

`globals.css` imports `controls.css`. Declare overrides on a `data-theme` or
`data-density` boundary so aliases resolve with that boundary's palette and density.
Defaults and documentation live together in the three sections of `controls.css`.

```css
[data-theme="brand"] {
  --button-bg: #254a38;
  --button-color: #fff;
  --button-border-color: #254a38;
  --button-radius: 8px;
  --button-font: var(--sans);
  --button-font-weight: 600;
  --button-text-transform: none;
  --button-hover-bg: #193626;
  --button-selected-bg: #193626;
  --button-selected-color: #fff;
  --button-selected-border: #193626;

  --input-bg: #fff;
  --input-color: #18271e;
  --input-border-color: #a7b5aa;
  --input-radius: 6px;
  --input-focus-color: #286043;
  --input-focus-border: #286043;
  --input-invalid-border: #b52b24;
  --input-invalid-focus-color: #b52b24;

  --form-gap: 20px;
  --form-field-gap: 8px;
  --form-label-font: var(--sans);
  --form-label-transform: none;
}
```

## Buttons

| Concern | Tokens |
| --- | --- |
| Appearance | `--button-bg`, `--button-color`, `--button-border-color`, `--button-border-width`, `--button-border-style`, `--button-radius`, `--button-shadow` |
| Sizing | `--button-height`, `--button-height-sm`, `--button-padding-x`, `--button-padding-y` |
| Typography | `--button-font`, `--button-font-size`, `--button-font-weight`, `--button-tracking`, `--button-text-transform` |
| Hover | `--button-hover-bg`, `--button-hover-color`, `--button-hover-border` |
| Pressed | `--button-active-bg`, `--button-active-color` (pointer activation); `--button-selected-bg`, `--button-selected-color`, `--button-selected-border` (`aria-pressed`) |
| Disabled | `--button-disabled-bg`, `--button-disabled-color`, `--button-disabled-border`, `--button-disabled-opacity` |
| Focus | `--button-focus-color`, `--button-focus-width`, `--button-focus-offset` |
| Motion | `--button-motion`, `--button-easing` |

Calendar, work-add, choice, lobby, account-submit, agent-submit, and chat-send
buttons consume this API. Compact calendar buttons use `--button-height-sm`.
Text actions retain their layout and borderless treatment. Not every component
uses every size token: `ui-button` is the complete generic recipe; its gap and
line height use `--button-gap` and `--button-line-height`.

Lobby pills retain dedicated `--button-pill-*` overrides for radius, padding-x,
padding-y, font-size, font-weight, tracking, hover-bg, and hover-color. Completed
answer choices keep their existing disabled opacity so the selected answer stays
readable. Recording instruments, media controls, graph/editor tools, navigation,
and other specialized buttons retain their existing component tokens.

## Inputs and selects

| Concern | Tokens |
| --- | --- |
| Appearance | `--input-bg`, `--input-color`, `--input-placeholder-color`, `--input-border-color`, `--input-border-width`, `--input-border-style`, `--input-radius`, `--input-shadow` |
| Sizing/type | `--input-height`, `--input-padding-x`, `--input-padding-y`, `--input-font`, `--input-font-size`, `--input-font-weight`, `--input-line-height` |
| Hover/focus | `--input-hover-border`, `--input-focus-bg`, `--input-focus-border`, `--input-focus-color`, `--input-focus-width`, `--input-focus-offset` |
| Disabled/read-only | `--input-disabled-bg`, `--input-disabled-color`, `--input-disabled-opacity`, `--input-readonly-bg` |
| Invalid | `--input-invalid-border`, `--input-invalid-focus-color` |
| Textarea | `--textarea-min-height`, `--textarea-resize` |

Calendar fields, account `.field` inputs, work-compose/search/filter controls,
agent inputs, chat textarea, and the theme selector consume the shared API.
Existing layouts retain their border treatment (boxed, underlined, or borderless),
width, and component-specific padding. Invalid styling uses `aria-invalid="true"`
or `:user-invalid`, avoiding red borders on untouched required fields.

Variants: account underlines use `--input-underline-padding-y` and
`--input-underline-font-size`; chat uses `--input-chat-font` and
`--input-chat-font-size`. The header theme selector uses `--select-bg`,
`--select-radius`, `--select-font`, and `--select-font-size`. Calendar textareas
and generic `textarea.ui-input` use the textarea minimum/resize tokens; the chat
composer retains its auto-sizing constraints.

Hidden upload inputs, checkboxes/radios, document editors, and media instruments
are deliberately excluded from these text-field rules.

## Forms and new controls

Use `.ui-button`, `.ui-input`, `.ui-form`, `.ui-field`, `.ui-label`,
`.ui-form-actions`, `.ui-form-help`, and `.ui-form-error` for new UI. These are
styling recipes; supply native labels, input types, disabled/read-only attributes,
and accessible validation messages in the component.

Form tokens: `--form-gap`, `--form-field-gap`, `--form-actions-gap`,
`--form-label-color`, `--form-label-font`, `--form-label-size`,
`--form-label-weight`, `--form-label-tracking`, `--form-label-transform`,
`--form-help-color`, `--form-help-size`, and `--form-error-color`.
Calendar layouts, account labels, agent/compose gaps, and existing form errors
are connected to the applicable tokens. Layout tokens affect existing gaps;
they do not add padding or rearrange forms.

Run `pnpm --filter web test:theme` for real-browser control override/state checks
and `pnpm --filter web test:theme-switcher` for the header selector regression checks.

## Action hierarchy and touch

Use `data-button="primary"`, `data-button="secondary"`, or `data-button="quiet"`
on the button recipe. Primary is the `.ui-button` default; calendar actions
without `data-primary` and work-add actions default to secondary. Explicit roles
override these defaults. Secondary and quiet actions omit the primary shadow.

Secondary tokens: `--button-secondary-bg`, `--button-secondary-color`,
`--button-secondary-border`, `--button-secondary-hover-bg`, and
`--button-secondary-hover-color`. Quiet actions use `--button-quiet-bg` and
`--button-quiet-color`, then share secondary hover colors. Pressed backgrounds
and foregrounds stay paired; override both together when changing a state.

Standard action recipes have a minimum 44px height on coarse pointers.
Ultra Compact also enlarges controls and input typography on narrow screens.
