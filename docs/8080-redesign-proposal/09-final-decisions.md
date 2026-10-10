# 09 — Final UX decisions and navigation

## Approved direction

One company tenant, not separate Work and Manage databases. Three primary areas: **Work**, **Manage**, **Stream**. Company logo/name is a prominent, separately accessible overview. Avatar is a first-class personal account gateway. Work and Manage are first-class top-nav controls with clearly exposed subareas, not simultaneously repeated in a left nav.

- **Work:** Tasks, Projects, Sprints collections; Board and Calendar are rich local views of shared task activity, one click away within Work. Project/sprint associations are optional for tasks, and sprints can span projects.
- **Manage:** Contacts, Inventory, Team, Automations (existing Agents), Documents. Shared table behavior and item anatomy, not a universal entity database table or identical fields.
- **Stream:** own immersive media/collaboration workspace.
- **Company:** inline editable summary, Settings for deeper integrations, fields/vocabulary, branding, access. Do not lose current Company abilities.
- **Person:** global profile/account settings owned by user; company member role and work live in Team.

## Standard page shapes

Collection -> full Item Page (inline properties, activity, domain content). New -> full Create Page using analogous anatomy. For complex editors, immerse within Item context (Agent Email Studio, Documents). Keep small dialogs/popovers for confirmation, simple pickers and trivial preferences only. Direct links and Back restore context and scroll.

## Studio-quality interaction

Immediate feedback, keyboard-aware search/command, stable focus and layout, predictable loading/saved/error states, careful drag/drop, undo for reversible actions, clear save versus activate/publish, and reduced-motion respectful transitions. Existing product business logic and permissions must be retained.

## Navigation constraints

No permanent 10-item left menu duplicating top bar. Optional collapsible quick rail for pinned/recent work is a separately tested later enhancement. Board and Calendar must be obvious in the Work local mode switch. Automations must be discoverable through words customers use (“scheduled email”, “customer report”, “team brief”) and contextual entry points, not only “Agents”.

## Scope protection

No replacement of existing email infrastructure, domain schemas or collaboration engine merely for visual unification. No forced Scrum. No mandatory drag-and-drop email HTML composer. No loss of themes. New Project/Sprint schema requires API, migration, permissions, calendar layers, and data integrity proof.
