# Current State Appraisal & Adversarial Review

## Overview
The application currently sets up a foundational layer for a communication tool, primarily focused on the "conversation surface" as a spatial instrument. The tech stack is well-chosen (React + Vite + TypeScript) for a highly interactive, replaceable frontend. 

## Current Directory Structure
```
src/
  api/          # API abstractions (client, errors, http, mock, types)
  app/          # Application entry/shell (App.tsx)
  components/   # Generic UI elements (ActionButton, Item, MediaView, Surface)
  hooks/        # React hooks (useMediaCapture)
  media/        # Media processing/services (service.ts)
  modules/      # Feature blocks (Composer, Feed, Recorder, Upload)
  state/        # Global UI state (ui.ts)
  styles/       # CSS tokens and globals
  main.tsx      # Entry point
```

## Adversarial Review

While this structure works for a single-view prototype, it will break down as we expand to a multi-page routing system, complex state management, and the overarching "retro-modernist spatial instrument" aesthetic.

### 1. `modules/` vs. `components/` Ambiguity
**Issue:** The line between a "component" and a "module" is blurry. Is `Composer` a component or a module? As the application scales, developers will struggle to decide where new UI pieces belong, leading to code sprawl and circular dependencies.
**Fix:** Adopt a stricter mental model. Move away from "modules" and toward a feature-driven architecture or atomic design scale (Atoms, Molecules, Organisms, Templates, Pages).

### 2. Lack of Routing & Screen Management
**Issue:** We need a top-level page for managing conversations, starting new ones, and differentiating between public/private streams. Currently, `app/` just has `App.tsx`, which implies a single-view app.
**Fix:** We need a routing mechanism (e.g., `react-router`) and a `pages/` or `screens/` directory to house the Lobby/Top-Level Dashboard and the Conversation Surface. Even the top page should function like a highly interactive interface rather than a standard web page.

### 3. Missing Domain Models & Relational State
**Issue:** Conversations are described as "branching conversation graphs underneath a simple chronological timeline." State management currently only has `state/ui.ts`.
**Fix:** We need dedicated graph/state management for real-time nodes (e.g., Zustand or Redux Toolkit, paired with something like React Query for server cache). We need a `domain/` or `types/` folder specifically for defining what a `Node`, `Branch`, and `Conversation` strictly are.

### 4. Component Composition Extensibility
**Issue:** "Industrial retro modernism" requires highly consistent primitive elements (thin rules, hard panels, primitive symbols, massive typography). If `ActionButton` and `Surface` do not enforce strict stylistic composition rules, developers will pollute the UI with ad-hoc styles.
**Fix:** Create a strict "Design System" sub-folder (`src/components/system/` or `src/system/`) containing the raw spatial primitives.

## The Goal
A structure that handles:
- A "Lobby" interface for discovering and managing conversations (public/private with topics).
- The "Instrument" interface for active spatial conversations.
- Robust, strictly typed graph logic for chronologies and branches.
- Predictable and rapid UI construction using pure geometric and retro-modernist primitives.
