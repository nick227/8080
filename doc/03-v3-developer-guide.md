# V3 Developer Guide

This app uses a highly modular, primitive-driven "V3" architecture. It relies heavily on a clean separation between **visual primitives**, **state/logic**, and **route-level views**. 

## Folder Structure

The `src/` directory is intentionally flat and avoids deeply nested domain subfolders.

```text
src/
├── api/          # Network layer, mocked responses, shared types
├── app/          # App entry points, routing logic (App.tsx, routes.tsx)
├── components/   # Pure visual primitives (Panel, Stack, Label, Media, Control, Item)
├── features/     # Feature-level compositions & hooks (Feed, Composer, Recorder, useMediaCapture)
├── media/        # Media processing services (prepareMedia, Blob management)
├── state/        # Zustand global state (data store, ui interaction state)
├── styles/       # CSS variables and global utilities (globals.css)
├── utils/        # Pure utilities (graph math, parsing)
└── views/        # Route-level page layouts (Room, Branch, Home)
```

## How to Manage Files

### Do `components/` need subfolders?
**No.** Components should remain purely visual primitives (`Panel`, `Stack`, `Control`, `Label`, `Media`). They should never contain business logic, domain state, or API calls. If you find yourself wanting to create a subfolder like `components/chat/` or `components/auth/`, you are likely creating a feature, not a primitive.
Keep `components/` flat. If a primitive is only used once, that is fine. It acts as a visual building block for the entire app.

### Where does domain logic go?
- **Global state / Caching:** `state/data.ts` (Zustand normalized store) or `react-query` hooks at the View level.
- **Pure Math / Relationships:** `utils/` (e.g., `utils/graph.ts` for tree traversal). Store facts in state; derive relationships in utils.
- **Complex UI Compositions:** `features/` (e.g., `features/Composer.tsx`). Features compose primitives together and attach local or global state to them.

### Where do Pages go?
Route-level assemblies go in `views/`. 
A View (e.g., `Room.tsx`, `Branch.tsx`) is responsible for reading from the URL/Router, subscribing to queries/state, and passing that data down into features and components.

### Core Rules

1. **See → Touch → Act:**
   - **See:** Visuals are handled by `components/` (dumb, stateless, visual).
   - **Touch:** Interaction state is handled by `state/ui.ts` (ephemeral).
   - **Act:** Network and data mutations are handled by `views/` mapping into `features/`.
2. **Store Facts. Derive Relationships.**
   - Normalize data in `state/data.ts`. Do not store arrays of nested children in state. Use `utils/graph.ts` to compute branches and relationships on the fly.
3. **Fail Safely.**
   - Real-time distributed systems have malformed data. Graph functions must tolerate missing parents, orphaned nodes, and cycles without hanging.
