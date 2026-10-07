# Agents Management Communication Automation — Design Pack

This package captures the current product direction for the new **Agents** communication automation surface.

## Files

- `00-agents-overview.md` — product model, terminology, families, and AI boundaries.
- `01-agents-ui-design.md` — key page sketches and interaction patterns.
- `02-agents-schema.md` — proposed server/data model.
- `03-agent-types-and-rules.md` — built-in email/social Agent types and their allowed controls.
- `04-email-delivery-requirements.md` — email-first execution rules and delivery constraints.
- `05-agents-requirements-and-phases.md` — MVP scope, non-goals, implementation phases, and cross-surface integration.
- `06-team-agents-addendum.md` — Team family: Daily team brief, Daily customer report.
- `07-implementation-roadmap.md` — slice-by-slice build plan against the current codebase.

## Current direction

The top-level surface is **Agents**, not Outreach.

The user primarily manages:

- built-in Agent instances,
- their messages,
- their type-specific rules,
- and a chronological river of Agent activity.

The system intentionally hides most automation-engine vocabulary.

The initial implementation should establish the pattern with **email first**, then add social with minimal architectural blast radius.
