# Architecture Roadmap & Proposal

To support the vision of a "spatial conversation instrument" with public/private discovery and highly interactive branching features, we need to evolve the directory structure. To avoid recreating the cognitive load in our codebase that we are trying to eliminate in the UI, the architecture should remain remarkably flat and avoid over-classification.

## Proposed Folder Structure

```
src/
  api/
    client.ts
    mock.ts
    types.ts

  app/
    App.tsx
    routes.tsx

  components/
    Surface.tsx
    Panel.tsx
    Item.tsx
    Media.tsx
    Control.tsx
    Label.tsx
    Rule.tsx
    Stack.tsx
    Grid.tsx

  views/
    Home.tsx
    Room.tsx
    Branch.tsx

  features/
    Capture.tsx
    Compose.tsx
    Playback.tsx

  state/
    data.ts
    ui.ts

  media/
    service.ts

  styles/
    tokens.css
    globals.css

  utils/
    time.ts
    graph.ts
```

## Immediate Action Items

1. **Routing Introduction:** Introduce `app/routes.tsx` to separate the `Home` view (discovery/top page) from the `Room` view (the conversation surface).
2. **Flatten Components:** Ensure all components in `components/` remain purely generic (e.g., `Panel`, `Rule`, `Stack`, `Grid`). No domain or product semantics should leak into these filenames.
3. **Isolate Feature Behaviors:** Move behaviors like capture, composition, and playback into the `features/` directory as single-file behavior boundaries.
4. **Normalize Graph State:** Centralize the graph logic into `state/data.ts` and pure functions in `utils/graph.ts` rather than spreading it across component names or nested folders.
5. **View-Level Composition:** Rely on `views/Room.tsx` and `views/Home.tsx` to compose the generic primitives into the final "conversation experience", enforcing a clean divide between low-level UI elements and the top-level product assembly.
