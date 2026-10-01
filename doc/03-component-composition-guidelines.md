# Component Composition Guidelines

To prevent code sprawl and maintain the strict "industrial retro modernism" aesthetic, all future frontend development must adhere to the following compositional rules. These principles should function as explicit code-review rules rather than just design guidance.

## The Guiding Rule: See → Touch → Act
Components must not preemptively display toolbars or deep menus. The interface should inherently reconfigure itself around the current action.
- **See:** A node exists in the timeline or conversation feed.
- **Touch:** The user focuses/selects the node.
- **Act:** The interface morphs around the node to expose primitive actions (Reply, React, Play, View Branch).

## Strict Separation of Concerns

### 1. Generic Primitives (`src/components/`)
These are the purest visual elements and layout arrangers: `Surface`, `Panel`, `Label`, `Rule`, `Control`, `Stack`, `Grid`.
- **Rule:** Zero business logic. They only accept style and visual props (e.g., `variant`, `active`, `children`).
- **Semantic Neutrality:** Avoid product semantics at this layer. Do not create `MessageNode` or `TimelineTrack` here. Keep them strictly generic. Let `Room.tsx` handle the product semantic composition.
- **Aesthetic:** Enforce the hard edges, thin rules, minimal accent colors, and massive typography alongside tiny metadata. Do not use generic borders or rounded corners unless dictated by the retro-modern aesthetic.

### 2. View-Level Composition (`src/views/`)
The views are responsible for combining generic primitives with domain data.
- **Rule:** They take structured domain types from the state and map data to primitives.
- **Example:** `Room.tsx` uses `<Stack>`, `<Panel>`, and `<Label>` to visually construct a conversation timeline. 

## Composition over Configuration
Avoid massive components with dozens of boolean configuration props. Favor Compound Components.

**Bad (Code Sprawl & Brittle):**
```tsx
<Node 
  isReply={true} 
  showPlayButton={true} 
  timestamp="21:14"
  onPlay={handlePlay}
  onReply={handleReply}
  reactionCount={2}
  mediaUrl="..."
/>
```

**Good (Compositional & Extensible):**
```tsx
<Panel variant="active">
  <Stack direction="row" justify="between">
    <Stack direction="row" gap="small">
      <Label variant="sequence">014</Label>
      <Label variant="meta">NICK</Label>
    </Stack>
    <Label variant="time">21:14</Label>
  </Stack>
  
  <Media src={mediaUrl} />
  <Label variant="caption">I think this version works better.</Label>
  
  <Stack direction="row" gap="medium">
    <Control icon="react" count={2} />
    <Control icon="reference" target="03" />
  </Stack>
</Panel>
```

## Motion and State
- **Restrained Motion:** Use CSS transitions exclusively for state changes (e.g., idle -> recording). Keep it smooth but restrained, avoiding bouncy or overly playful physics.
- **One Dominant Object:** When state changes (e.g., to "Recording"), the composition should hide extraneous information and let the active component dominate the layout area. Focus visual priority aggressively.
