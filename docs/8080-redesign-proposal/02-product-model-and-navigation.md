# 02 — Product model, ownership and navigation

## Conceptual model

**Account (person)** — global authenticated identity; owns user avatar, display name, personal profile/bio, account preferences, security, notification preferences and memberships. Accessible without first opening a company. Do not confuse global account identity with company-specific job title/role/presence.

**Company / Workspace (tenant)** — customer business environment; owns company logo/brand, company overview and admin settings, members and permissions, shared contacts, inventory, docs, agents, conversations, tasks, sprints, projects and integrations. Keep existing `Workspace` technical naming if it already defines tenancy; call it Company in UX where appropriate. Do not casually rename DB model `Workspace`.

**Membership / team member** — relationship between account and company, with roles/access, title, department, current focus, company-visible accomplishments/presence and assigned work. Team member page is a domain item; user account profile is a separate account page. Honor privacy and permissions between companies.

**Project** — company-owned grouping of related work, with optional owner, description, status, start/end/target, linked documents, tasks and milestones. A company contains many projects; a task may have no project.

**Sprint** — company-owned timebox with goal, start/end, lifecycle and a set of task assignments. Prefer company-wide sprints crossing projects; avoid forcing sprint→project parentage. A task may have no sprint. Initially single optional `sprintId` per task is sufficient subject to schema/product audit; retain ability to model membership/history later.

**Task** — work record associated with workspace, optional project/sprint, assignee, state, dates, priority, checklist, dependencies, activity and links. Existing task lifecycle/visibility is preserved.

## Final navigation architecture — binding decision

**Primary areas: Work, Manage, Stream.** Company identity at left opens Company Overview; personal avatar at right opens an account menu and global Profile. Do not add a second generic Workspace selector or a permanent duplicated sidebar.

**Top bar:** `[Company logo/name ▾] [Work ▾] [Manage ▾] [Stream] ··· [Search] [Bell] [Avatar]`. Work and Manage each remember the last used subview, support direct deep linking and reveal all contained destinations in a keyboard-accessible selector.

**Work:** `Tasks`, `Projects`, `Sprints` are collections. `Board` and `Calendar` are distinct full-width task canvases. Display `Tasks | Board | Calendar` as immediately visible, labeled **local Work modes**; place `Projects | Sprints` in adjacent clear Work collection navigation. A project is a grouping of work; a sprint is a timebox and may encompass multiple projects. Existing tasks may have no project or sprint. Shared filters are explicit and predictable.

**Manage:** `Contacts`, `Inventory`, `Team`, `Automations (Agents)`, `Documents`. These remain distinct business entities with distinct capabilities but adopt shared collection and full-page item/create contracts. Highlight Automations as “Scheduled emails, team updates & automations” through descriptive navigation, search and contextual launch actions.

**Stream:** Dedicated real-time/media/conversation surface, never flattened to collection table.

**Company:** branded overview, editable inline where permitted; advanced settings (branding, profile, variables/vocabulary, integrations, access, sender identities) behind a Settings button. Preserve all capabilities.

**Avatar / personal profile:** global account-owned user profile, preferences and security, separate from company-specific team member profile, with membership-sensitive visibility.

**Optional quick navigation:** A collapsible favorites/recent rail may be prototyped *later* and shipped only when tested to add discoverability or speed without duplicating the top navigation. The previously generated mockup is a visual concept, not a specification to display the entire sitemap twice.

**Responsive:** compact labeled selectors at narrow widths; no icon-only discovery dependency; preserve deep links, browser history, focus and per-collection scroll/filter state.

## Company Overview

Reach by clicking company name/logo, *not* through generic record table. Show branded identity, useful summary, metrics/activity and inline-editable overview fields. Put advanced configuration behind **Settings** with named sections; preserve profile, logo/gallery, company variables/vocabulary, integrations, visibility, members/permissions, email sender setup and relevant functions. Remove large embedded task table from overview **only after Work contains the complete replacement**; give compact linked summary instead. Show save/sync/error feedback for inline fields. Editing requires permissions; others see read-only content.

## Avatar and account profile

Prominent user avatar (recommended ~36–40px hit target, scalable via tokens), available from any company. Avatar menu includes view profile, account settings, notification settings, company memberships and sign-out. Profile full-page, global route, accessible outside company. Design account profile with name, avatar/photo, about/bio, contact visibility, preferences; separate private security settings. Team member profile reflects membership data and work and can link to allowed personal identity fields. Different company memberships may render different job titles or roles. Don't leak private account fields to the team.

## Route and navigation state policy

Current app routes mainly through `/room/:roomId` plus desk query state. Move toward stable, directly addressable links **without breaking existing share URLs or room routes**. Proposed conceptual shapes (validate against server and Router before choosing concrete paths):

```
/account/profile
/account/settings
/company/:companyId/overview
/company/:companyId/settings/:section
/company/:companyId/work/tasks
/company/:companyId/work/projects
/company/:companyId/work/sprints
/company/:companyId/work/board
/company/:companyId/work/calendar
/company/:companyId/manage/:collection
/company/:companyId/manage/:collection/new
/company/:companyId/manage/:collection/:itemId
/company/:companyId/manage/agents/:agentId/message
/company/:companyId/stream/:roomId
```

Existing `/room/:roomId` experience may remain the real container while using query segments or nested routes. Treat above as **illustrative**, not a directive to rewrite all URLs. Record link compatibility tests and redirects/aliases first. A specific task key must continue linking directly to task detail; agents and document item IDs must also be shareable under access control.

Preserve collection-specific URL/search/filter/sort/group/view state, scroll and selection when navigating to items and back. Avoid leaking one collection's search query into another. Browser Back/Forward must behave as a real navigation tool; `Escape` closes transient UI, not arbitrary full-page edits.

## Navigation acceptance criteria

- From every main surface, reach Work, Manage, Stream, Company, and Account with predictable paths.
- Company identity is always legible and branded; account avatar always distinguishable and accessible.
- Tasks↔Board↔Calendar transitions retain project/sprint filters when semantically compatible.
- Manage contains all 5 collections, each discoverable with keyboard, pointer and touch.
- New item actions reflect selected entity, permissions, and resulting full-page create route.
- No disabled dummy search control or misleading labels; clarify that Agents are not general chat.
- Direct item links and browser history survive reload; bad/unauthorized URLs show useful recovery.
- Test 390–1440px layouts, with chat expanded/collapsed, no horizontal app-shell overflow.
