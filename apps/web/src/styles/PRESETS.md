# Theme catalog

Every preset is a self-contained token override in `presets/`. All are registered
in `src/theme/registry.ts`; the select groups them without theme-specific UI code.
The four product-named themes are independent interpretations of their visual
language, not imported vendor design systems. Font stacks use local/system fonts
and fallbacks, so switching themes never waits for a font download.

| Theme | Palette and typography | Signature |
| --- | --- | --- |
| Material | Lilac tonal surfaces, violet accents, system sans | Rounded elevated controls and capsule actions |
| Apple | Porcelain, cool gray, blue, system sans | Restrained borders, inset fields, precise rounded controls |
| OpenAI | Warm monochrome with evergreen accents, system sans | Quiet surfaces and dark pill actions |
| Discord | Slate layers, blurple, system sans | Dark channel-like surfaces and compact friendly controls |
| Monokai | Editor charcoal, pink, lime, cyan; sans content with mono utilities | Syntax-inspired state colors and lime buttons |
| Brutalist | Concrete, black, yellow; heavy sans | Square geometry, strong rules, offset hard shadows |
| Ultra Large | Cool blue-white, generous sans | 20px body text, larger controls and rows, 1.4 density |
| Ultra Compact | Graphite, pale gray, teal; sans with mono utilities | 13px body text, tight rhythm, 0.75 density |
| Hyper-modernism | Midnight indigo and electric cyan; geometric sans stack | Crisp edges, spaced labels, restrained cyan glow |
| Bauhaus | Architectural ivory, primary red, cobalt, yellow; geometric sans stack | Hard geometry, weight, color-coded action/focus |
| Dream World | Cloud lilac, berry, lavender; serif content and friendly sans | Generous curves and soft lavender shadows |
| Editorial Magazine | Paper, ink, oxblood; book serif content | Square rules, editorial type hierarchy and wide section spacing |
| Retro-terminal | Deep evergreen and phosphor green; monospace | Square inverted controls, no scanline or blinking effects |
| Zen Minimalism | Rice paper, moss, inkstone; serif content | Spacious rhythm, light visual weight, minimal decoration |
| Nightmare Horror | Bruised burgundy, bone, blood-red; literary serif | Dark atmosphere, sharp controls, no flicker or forced animation |

The original Dark and Light themes remain available under Essentials. Default
startup behavior stays unchanged unless a preference was saved.

## Authoring and maintenance

- Add one CSS file, its `@import` in `themes.css`, and one registry entry. IDs are
  saved preferences: keep them stable when renaming labels or groups.
- Define all principal surfaces for new palettes; changing only `--bg` and `--ink`
  leaves the dark baseline's secondary surfaces in place.
- Component tokens in these presets use `[data-theme]` specificity to override
  aliases. Density defaults use `:where([data-theme])`, so a user's explicit
  `data-density` setting wins. Large/compact themes also deliberately customize
  type and control dimensions independently of density.
- Reduced-motion overrides follow the imports and match preset specificity.
  Do not add high-specificity motion rules that bypass these overrides.
- Primary text, muted text, accents, and standard button pairs are contrast-tested
  in the new themes. This is a targeted check, not a full application accessibility
  audit; media overlays, disabled states, and content-authored colors differ.
- Paper/media palettes stay independent. Editorial and Horror customize paper
  explicitly; native images and stored map colors are not recolored by presets.

## Review workflow

`pnpm --filter web test:theme-gallery` uses the real registry, switcher, theme
entry stylesheet, and representative workspace controls. It switches every theme,
checks narrow 320px/375px layouts, large/compact behavior, representative contrast,
actual hover/pressed contrast for primary, secondary, selected, and quiet actions,
coarse-pointer target heights, and reduced motion. Optional `THEME_SCREENSHOTS=/tmp/theme-previews` writes full
page desktop and mobile screenshots. The gallery is a test fixture, not a public
application route.

## Community-inspired additions

Fjord, Workshop, Periwinkle, and Wayfinder live under **Community inspired** in
the selector. See [design rationale and feedback sources](./COMMUNITY-THEMES.md)
for their palettes, typography, usability choices, and validation scope.

## Art house

Four deliberately theatrical presets push the existing token API without adding
page-specific markup, downloaded fonts, or animation:

| Theme | Palette and type | Signature |
| --- | --- | --- |
| Acid Opera | Aubergine `#290d39`, chartreuse `#dfff66`, blush-white text; Georgia display, Trebuchet body, mono metadata | Alternating sweeping corners and pill actions with a lavender hard shadow |
| Cobalt Cabaret | Cobalt `#102fab`, butter `#fff7c2`, coral `#ffac8c`; Georgia display, practical sans body | Full saturated-blue canvas, square panels, double-step action shadows |
| Bubblegum Riot | Pink `#ff9fd2`, black-plum `#24051d`, lemon `#eeff63`; Impact/Arial Black display, Arial body | Oversized block headings, asymmetric cutout corners, black offset shadows |
| Obsidian Gilt | Petrol `#092b2c`, champagne `#f3d288`, ivory `#fff0ce`; Palatino/Georgia display, Trebuchet body | Arched panel corners, gold rules, inset engraved action borders |

The workspace composition stays predictable: content and form panels sit beside
each other on desktop and stack on mobile. Expressiveness lives in palette,
display typography, geometry, and primary-action treatment. Body text stays sans;
secondary controls omit theatrical shadows. Narrow screens reduce section gaps
and title tokens. Focus rings remain conspicuous and reduced motion is inherited.

The visual critique avoids four variants of neon-on-black: this set includes a
saturated blue canvas, a bright pink light theme, a velvet purple theme, and a
restrained decorative petrol/gold theme. Font stacks have local fallbacks; display
appearance can differ by operating system. Gallery contrast, pointer states,
mobile overflow, and touch-target checks automatically include all four.
