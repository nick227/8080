# 14 — Mobile + Chat Implementation Checklist and AI Developer Prompt

## Read order and precedence

Read core redesign documents 01–11 in the final 8080 commercial handoff, followed by these addenda 12 and 13. **Final navigation direction:** Work / Manage / Stream; Company in brand header; Account via avatar. Board/Calendar are modes in Work; Automations is a Manage collection, not chat. Full-page creation/editing default. No duplicated permanent sidebar. Existing themes/densities must remain functional.

## First checkpoint: no code until verified inventory

- [ ] Identify exact current Git HEAD and all UI/chat/mobile-related files, routes, SDK APIs, server contracts and theme tokens.
- [ ] List current mobile-specific capabilities and defects with browser screenshots; don't infer from CSS alone.
- [ ] Verify current `ChatShell` closed/open/full behaviors, Stream transport and activity integration; identify what is actually implemented.
- [ ] Identify overlapping labels: Messaging/Agents, Chat, Stream, notifications and account identity.
- [ ] Compare permissions/tenant checks for all chat/message/document/file routes.
- [ ] Produce a route/state contract and incremental acceptance plan with rollback paths.

## Build checkpoints

- [ ] Phone navigation reachable by labeled controls, direct links and browser Back.
- [ ] Adaptive collection/list/table rendering for every Manage/Work domain and contextual New.
- [ ] Full-page edit/create retained on phones, including agent recipient and scheduling forms.
- [ ] Board non-drag alternatives and usable Calendar agenda/milestones/sprints.
- [ ] Email Studio editor/preview switch, stable draft state and safe test/activation.
- [ ] Global chat affordance; docked, expanded and mobile full-page modes with shared conversation state.
- [ ] Stream and chat switch without unexpected media side effects.
- [ ] Avatar → account, member avatar → scoped member profile.
- [ ] Message drafts, scroll anchors and pending/error states recover reliably.
- [ ] Accessibility: keyboard, focus, screen-reader, touch target, reduced motion, viewport keyboard.
- [ ] Every existing theme/density checked, including overlays and Stream/Chat controls.
- [ ] No loss of legacy features or backwards-compatible deep links.

## Exact prompt for AI developer

> Implement the two 8080 addenda `12-mobile-responsive-experience.md` and `13-chat-collaboration-experience.md` within the previously approved full redesign. Treat the newest source code as authoritative for existing behavior. Start with a verified browser and code audit, then ship reversible milestones. Keep Work/Manage/Stream and company/avatar ownership separation; don't reintroduce duplicated sidebars or reduce substantive editing to modals. Make every collection and specialized page functional on phone/tablet while preserving desktop and theme/density parity. Make global Chat accessible and coherent with the live Stream surface, without confusing human chat with the Automations/Agents email and team-message feature. Preserve existing message/agent data, permissions, transport and sending semantics. Present the before/after route map, exact component plan, screenshots at 390/768/1440, all-theme visual-regression results, E2E journeys, regressions and deployment rollback. Flag unsupported capabilities rather than creating fake UI.
