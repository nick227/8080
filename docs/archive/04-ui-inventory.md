# UI Inventory

## Primitives (`src/components/`)
Stateless, visual-only building blocks.
- **`Panel`**: Box container with variants (`shell`, `header`, `item`, `reply-strip`).
- **`Stack`**: Flexbox column/row layout.
- **`Grid`**: Grid layout wrapper.
- **`Label`**: Typography with variants (`h1`, `eyebrow`, `caption`, `meta`, `sequence`, `time`).
- **`Control`**: Interactive `<button>` with ARIA states (`action`, `record`, `default`).
- **`Media`**: Optimized media renderer with custom `<CustomVideo>` wrapper, Spatial Audio routing, and waveform visualizations.
- **`Blobs`**: Ambient framer-motion presence indicators reacting to local and global recording states.
- **`Rule`**: Visual separator/border.
- **`Surface`**: Z-index overlay for modals/takeovers.
- **`Item`**: Composed representation of a single message node.

## Features (`src/features/`)
Domain-aware assemblies bridging state and primitives.
- **`Feed`**: Spatial layout engine with desktop horizontal graph traversal and mobile vertical layouts. Supports `GhostItem` previews.
- **`Instrument`**: Centralized, unified capture UI replacing fragmented Composer/Recorder layers. Handles text, audio, and video flows seamlessly.
- **`useMediaCapture`**: High-performance hardware bridge, managing streams, AudioContext amplitude generation, and waveform slicing.

## Views (`src/views/`)
Route-level assemblies connecting the API to features.
- **`Home`**: Discovery lobby and global stats.
- **`Room`**: Main real-time conversation timeline and ambient presence hub.

## State (`src/state/`)
- **`data.ts`**: Normalized Zustand store (`itemsById`, `orderedIds`) acting as the local read model bridging `@project/sdk` SSE events.
- **`capture.ts`**: Dedicated deterministic finite state machine (`idle` → `arming` → `recording` → `review` → `uploading`) decoupling media from UI.
- **`ui.ts`**: Ephemeral spatial layout state (playback modes, traversing depth, composing takeovers).

## Utilities (`src/utils/`)
- **`graph.ts`**: O(1) indexed ancestry and branch calculation.
