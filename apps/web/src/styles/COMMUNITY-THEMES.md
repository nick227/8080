# Community-inspired themes

Four original interpretations for a workspace used to read conversations, play
recordings, and organize work. These are not official ports of other palettes.
No external fonts, effects, or assets are required.

## Feedback and design decisions

Community discussions are qualitative inspiration, not representative research
or proof that one palette reduces eye strain. Users differ; keep all presets
available and preserve independent density settings.

- [Obsidian theme discussion](https://www.reddit.com/r/ObsidianMD/comments/197h27p/what_are_some_of_your_favorite_obsidian_themes/): Nord and Gruvbox recur among preferences; one complaint describes low-contrast surfaces blending together. Fjord and Workshop take those cool/warm directions but keep visible field boundaries and readable secondary text.
- [Community theme preferences](https://www.reddit.com/r/ObsidianMD/comments/q75b4o): feedback includes dislike of cursive typography and low-contrast navigation labels. All four use practical sans-serif content and visible navigation icons.
- [Catppuccin project](https://github.com/catppuccin/catppuccin): its community-driven pastel approach inspires Periwinkle's restrained lavender surfaces. Dark plum text and deep violet actions keep pale colors out of foreground roles.
- [NN/g's study of flat controls](https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/): weak visual signifiers caused uncertainty. Wayfinder emphasizes outlined fields, clear action hierarchy, and conspicuous focus indicators. This does not constitute a claim of full accessibility conformance.

## Design plan and final signatures

| Theme | Core palette | Type and rhythm | Signature |
| --- | --- | --- | --- |
| Fjord | Slate `#242d3a`, raised slate `#303c4c`, snow `#edf3fa`, glacier `#9bd6e5`, steel `#61738b` | Humanist system sans, mono metadata, normal density | Small-radius layered panels and glacier action fills |
| Workshop | Charcoal `#292620`, walnut `#353128`, parchment text `#f5ecd9`, brass `#f2c36b`, stone `#817563` | Trebuchet with system fallback, mono form labels, sturdy 40px controls | Amber controls with a short hard shadow and squared edges |
| Periwinkle | Lavender gray `#f0eff8`, pale lilac `#faf9ff`, plum `#302b48`, violet `#6440a3`, dusty lavender `#a19bb4` | Avenir/Trebuchet with sans fallback, relaxed density | Broad rounded panels with deep violet actions and restrained elevation |
| Wayfinder | White `#ffffff`, blue white `#f2f6fb`, navy `#10243c`, cobalt `#164da5`, steel `#72869c` | Verdana, mono metadata, generous 44px controls | Strong field outlines and separated 3px keyboard-focus rings |

All retain the existing page composition: header, workspace content, adjacent
form panel; panels stack on narrow screens. Distinction comes from surface depth,
type, geometry, and control hierarchy rather than theme-specific markup.
The design critique deliberately avoided another serif paper theme or neon dark
preset, since the existing catalog already covers those directions.

## Validation

The registry-driven gallery covers all four automatically: body/accent/button
contrast, actual hover and pressed states, 320px and 375px overflow, coarse-pointer
button heights, and reduced motion. Switcher persistence and density checks remain
shared. Screenshot review uses `THEME_SCREENSHOTS=/tmp/community-themes pnpm
--filter web test:theme-gallery`. These checks cover representative components;
user-authored content and specialized editors still need application-level review.
