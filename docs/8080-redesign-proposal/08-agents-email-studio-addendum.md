# 8080 UX Redesign Addendum 08 — Agents, Email Studio & Scheduled Communications

**Developer-ready supplement to the Commercial UX Redesign Proposal**  
**Priority:** high — feature discoverability, task completion, delivery safety  
**Status:** proposed design; reconcile against latest repository HEAD and running product before implementation.

## 0. Executive decision

Communication automation should feel like a **first-class business capability**, not an obscure configuration table. In the current UI, the navigation label is `Messaging`, the rendered page title is `Agents`, and the main surface combines a dense agent table and a second execution-history table. A new customer is unlikely to immediately understand that **this is where scheduled customer emails and internal team briefs are created**.

**Recommendation:**
- Treat **Agents** as the underlying automation concept and schema term.
- Use clear customer-facing language in the entry point: **Automations** or **Messages & Automations** (product decision to validate), with descriptive affordances such as **Scheduled emails**, **Team briefs**, **Customer reports**, and **Activity**.
- Keep Agents within the proposed **Manage** family for information architecture consistency, but make it **prominent through global search/command, shortcut or quick navigation, and contextual entry points**. Do not solve a buried feature by simply adding a noisy permanent tab.
- Agent list = shared `CollectionWorkspace`. Agent configuration = full `ItemWorkspace`. Email composition = immersive specialized `Message Studio` **within the agent item**. No substantial creation or editing in a drawer.
- A new user's path should be: **Find → Choose purpose → Configure → Compose → Preview/Test → Activate → Monitor**.
- Preserve existing API, sender-authorization gates, recipient safeguards, delivery scheduling, template rendering, and execution history during UX migration.

## 1. Current-state deep dive and evidence

Inspected in `nick227/8080` (repository main at audit time; source inspection, not comprehensive runtime usability test):

| File | Verified behavior | UX / design diagnosis |
|---|---|---|
| `features/work/sections.ts` | Global navigation item `{ id: 'agents', label: 'Messaging' }` | The label does not reveal scheduled email or automation capabilities. |
| `features/work/WorkPage.tsx` | `agents` opens `AgentsDesk` | Feature is reachable but grouped with unrelated desk destinations. |
| `features/agents/AgentsDesk.tsx` | Heading `Agents`; toggles list, catalog, editor and event detail from URL parameters. Landing stacks `AgentList` then `AgentRiver`. | Ambiguous vocabulary, crowded first screen, weak separation between building and monitoring. |
| `features/agents/AgentList.tsx` | Table shows name, type, sender, schedule, recipients, channel, status, attention, delivery and action | Valuable but too much at once; min width set to ~1500px via CSS, which creates horizontal work on typical desktops. |
| `features/agents/AgentCatalog.tsx` | Presets grouped by Email, Team, Social; table of template, family, schedule and action; many named prefabs exist. | Catalog resembles an administrative table, not an inviting use-case chooser. Verify which preset families are actually deliverable before promoting them. |
| `features/agents/AgentEditor.tsx` | Large (~579 line at audit) editor with editable agent name, status/start/pause, From, delivery channels, triggers, repeat/time, recipient configuration, subject, body, content sections, style, preview, test and other actions. | Too many independent decisions on one dense surface. Fields mix conceptual phases; need progressive disclosure and a coherent edit state model. |
| `features/agents/AudienceEditor.tsx` | Audience rules and preview count; editing uses `FormSlideout`. Clearing final rule deliberately avoids silently broadening to all contacts. | Important safety behavior; substantive audience building should move to full-page agent section; preserve protection. |
| `features/agents/AgentRiver.tsx` | Standalone event history table with statuses, schedule, results and drilldown | Monitoring should be accessible both per agent and globally, but not dominate the first-time launch screen. |
| `features/agents/agents.css` | Agents-specific editor/table/preview grid and custom elements; list min width ~1500px | Divergent anatomy from proposed standardized table/item/editor contracts. |
| `features/company/IntegrationsSection.tsx` and email APIs | Sender integrations managed at company level | Agent creation needs clear sender status and a direct route to resolve unavailable connections. |

**Audit qualifications:** Confirm actual state machine, tests, API behavior, server preview freshness and connector capabilities before editing. Features described here as target designs are not assertions of existing capability. Do not change email delivery rules without explicit product approval.

### Actual interaction debt to record in browser audit

For each item capture desktop 1440/1280, laptop 1024, narrow/mobile, keyboard-only, light/dark/high-contrast:
1. How many clicks from a new company landing to "Send a scheduled customer email"?
2. Does the `Messaging` label explain what the area does?
3. Are catalog presets understandable without developer knowledge?
4. Can a user see current status, sender identity, audience size, and next run at a glance?
5. Can users tell **saving changes** apart from **activating delivery**?
6. Can they recover from missing or expired sender integration in the same workflow?
7. Is subject/body editing visually linked to the rendered preview?
8. Does preview show realistic token/merge-field values and freshness?
9. Can a user confidently send a test without sending to their real audience?
10. Can a user find and diagnose a failed scheduled run?

Record video/screenshots, journey timing, accessibility findings and failing current-state tests. Separate verified failures from suspected issues.

## 2. Information architecture — give automation a discoverable identity

**Suggested consumer-facing label:** `Automations` (short, extensible) with an immediately visible subtitle "Scheduled emails, team briefs, and business messages." Alternative: `Messages & Automations` if research shows users naturally seek scheduled email under Messaging. Keep internal `agents` route/domain naming stable during migration.

Access paths:
- **Manage → Automations** via grouped Workspace dropdown.
- Global quick search: synonyms **email**, **scheduled email**, **newsletter**, **team brief**, **customer report**, **agent**, **message automation** all find the same area or creation actions.
- Optional favorite/pinned quick-nav entry, with text label on hover/expansion; do not make icon-only navigation the only discovery route.
- Empty-state and onboarding links from Company Overview: **Schedule a customer email**, **Create team brief**, **Connect sending address**.
- Contextual actions from Contacts: **Create an email agent for this audience** (prepopulate recipients and return path safely).
- Contextual status/link from Company → Settings → Integrations: **Use this sender in an automation**.
- Activity and notification links deep-link to an agent run or its item detail.

Do **not** duplicate the entire automation UI under a second navigation destination. Links should go to canonical agent URLs.

## 3. Agent landing — turn the feature into an understandable work surface

Use the universal `CollectionWorkspace` but with domain-appropriate framing.

### Recommended layout
1. Page identity: **Automations**; one-sentence purpose; primary **New automation**.
2. Actionable summary (compact, not generic KPIs): **Active**, **Needs attention**, **Next scheduled**, **Recently sent**. Only show accurate data.
3. Primary collection table: Name | Purpose / Channel | Audience | Next run | Status | Attention. Optional columns for sender, schedule, last run, owner, failures.
4. Domain filters/presets: All / Active / Draft / Paused / Needs attention; email/team/social if enabled. Search, sorting, saved views, column menu, density use shared collection contracts.
5. Execution activity: a **Recent activity** section with a few latest events and `View all` that opens dedicated activity view; not a second enormous table competing with the list.
6. Empty state: purpose-led choices, not "No agents."

Each row has a **plain-language summary**:
`Daily customer report · Email · 124 recipients · Weekdays at 5 PM · Next today 5 PM`.
Use real values/time zone; do not invent next executions.
Status taxonomy distinguishes **Draft / Active / Paused / Needs attention / Archived**. "Needs attention" can be an overlaid health/attention state, not necessarily a new server lifecycle state.

**Caution:** Column minimization is a UX default, not field removal. Preserve all existing fields through optional columns, row detail, and history.

## 4. Creation UX — start with intent, not implementation jargon

Full-page route suggested: `/company/:companyId/automations/new` (illustrative; exact routes follow existing app's routing convention).

### First screen: "What would you like to automate?"
Use distinct intent cards:
- **Email customers** — scheduled reports, newsletters, announcements.
- **Keep the team updated** — briefings and internal chat/email delivery.
- **Follow up with contacts** — business-event-triggered communication.
- **Social updates** — only when configured channels are operational and clearly labeled.
- **Start from template / Blank** — advanced option.

After selecting an intent, show templates with short summaries: trigger, recipients, typical schedule, required integration, example output. A template is a **starting configuration**, not a pre-authorized live sender.

A creation flow is **not a rigid wizard**; use an item page with visible sections and readiness. Suggested default priority:
1. **Essentials:** name/purpose, channel and sender readiness.
2. **Message:** write content, choose included sections, inspect example.
3. **Audience:** choose recipients, view estimated count / eligibility; never assume all contacts.
4. **Timing:** on-demand, schedule, or event-trigger.
5. **Review & activate:** summary, validation, explicit action.

Allow free movement between sections, save draft, resume later. Deep-link into a section if appropriate. Avoid an initial wall of every possible control.

## 5. Agent Item Page — standard anatomy, domain-specific depth

Use the global `ItemWorkspace` layout:

**Identity header:** Breadcrumb `Automations / Agent name`; editable title; status; short purpose; actions Save/Publish or Start, Pause/Resume, More. Make primary action reflect lifecycle, not a generic "Save" implying send.

**Readiness ribbon:** 
- Sender: selected address and status
- Recipients: source, eligible count / reason not countable
- Channel: email, internal chat, or supported combo
- Timing: human-readable trigger/schedule and timezone
- Next run: timestamp or "Not scheduled"
- Outstanding blocker: one actionable message with deep link

**Main sections:** `Overview`, `Message`, `Audience & Delivery`, `Schedule & Trigger`, `History`.
Prefer anchored sections or compact local sub-nav. Do not force tabbing for every small property; use disclosure where necessary.

**Overview:** latest result, next run, current health, last edit, short purpose, primary links to content and history.

**History:** execution list scoped to this agent with event detail, counts, channel, time, errors and retry guidance (retry only if service supports safe idempotency). Do not fabricate resend controls.

**State visibility:** show Draft, Saving, Saved, Validation issues, Publishing/Activating, Active, Paused and Error clearly; preserve backend distinctions where they exist.

## 6. Email Studio — make design feel like a creative tool

This is the centerpiece of the addendum. The email designer must be a substantial **full-page editing region**, not a small slideout or crowded generic form.

### Layout contract
- Upper stable item header: `Automations / Daily customer report / Message`; Save state; `Send test`; `Preview`; `Activate/Publish` when appropriate.
- Left ~40–50%: **Editor** containing content structure and fields.
- Right ~50–60%: **Live rendered preview** in its own scroll region. Allow adjustable divider if ergonomic and performant. On smaller screens toggle editor/preview, do not squeeze both.
- Optional left *local* design tools or toolbar, but no always-visible global sidebar just for this feature.
- Preview can toggle **Email Desktop / Email Mobile / Plain text / Internal chat** (only available for configured destinations).
- Full-screen preview mode with return to the exact editing position.

### Content mode
- Sender identity displayed read-only with "Change" linking to Audience & Delivery; subject and preheader, body, included data blocks/sections, merge-field helper.
- Preserve existing `subject`, `customText`, included sections and merge fields; preheader only if backend/rendering supports it, otherwise mark an explicit future enhancement.
- Present a lightweight hierarchy: Subject → Introduction/body → Dynamic sections → Footer. Keep templating safety and default-content restoration.
- Include insert-merge-field workflow with supported values, examples, and validation. Never surface unsupported placeholders as available.
- Show a sample recipient/data context for preview; ensure clearly marked **example only**.
- Dynamic sections display enabled state, meaning and actual preview counts; where zero, explain "No matching items in current preview" rather than disappearing silently.

### Design mode
- Template selection using **visual thumbnails**, not an unannotated select.
- Theme preset and branding controls appropriate to email: typography, logo, accent, spacing, footer.
- Company identity defaults may inform output; **application UI theme must never automatically change email HTML design**.
- Do not promise arbitrary email HTML editing or drag-and-drop support in phase one. The existing template-based system is an asset.
- Changing template/style should preserve user-authored content unless user explicitly requests destructive reset.

### Preview mode
- Use existing server `useAgentPreview` output and sandboxed `iframe srcDoc`; preserve text/chat fallbacks.
- Provide stale/refreshing indication; debounce and avoid flicker; preserve scroll and input focus during re-render.
- Preview must match the same data/configuration revision targeted by tests; identify when preview is stale relative to unsaved draft.
- Sandbox boundaries must remain in place; never execute generated HTML/scripts in the parent app.
- Render under a neutral preview background (email-specific) regardless of dark/light app theme.
- Indicate email clients vary; verify with real client samples later rather than claiming perfect rendering.

### Save, test and activate
The present code contains both debounced autosave behavior for subject/body and an explicit Save action. **Audit their actual semantics and eliminate conflicting user expectations.**

Target UX:
- Editing is always visibly **Draft / Unsaved / Saving / Saved**, with validation feedback.
- **Save draft** stores the current configuration; **Send test** sends only to explicitly confirmed test recipients.
- **Activate / Resume** requires sender, audience, schedule and content validation. Show a concise review of destination(s), sender, target estimate, next firing time and timezone.
- For an **already active agent**, determine whether editing changes live configuration immediately. If it does, explicitly show "Changes may affect future deliveries" and protect drafts; do not imply versioned publishing exists until engineered and tested.
- For an actual publish model, immutable revision + activation boundary is preferable, but is a **separate backend design decision**, not a cosmetic refactor.
- Never automatically send a live customer campaign when a user saves or tests a design.

## 7. Sender authorization, channel configuration and tenancy

This is critical for a commercial multi-company product.

**Sending identity controls:**
- User chooses from **company-authorized senders**, each with provider, email address, display name, verification/health status.
- `Send as` and `Reply-To` are separate concepts and must be labeled distinctly.
- Google sign-in does **not** imply Gmail sending authorization. Email permission is a distinct OAuth connection/scope flow.
- Do not imply Amazon SES, Resend, SMTP, or Google OAuth automatically authorizes arbitrary user-controlled From addresses.
- Company Settings → Integrations manages connections; agent editor consumes authorized identities. When unavailable, show recovery action with return location preserved.
- Never silently fall back to another sender, channel or tenant.

**Multi-tenancy and permissions:**
- All agent reads/writes/previews/recipient resolutions belong to the authorized company.
- Server enforces member role and explicit permission checks for sender changes, activation, audience access and execution detail.
- Show view-only mode for non-editors with comprehensible reasons.
- Secrets/tokens never appear in client preview or logs. Do not leak contact email addresses in general-purpose preview.

**Channels:**
- Email and internal chat can coexist where supported; preview each separately.
- Distinguish "audience" (who) from "destination" (where/how); changing one must not silently alter the other.
- For social templates, show their genuine supported stage rather than imply email-like behavior if integrations are missing.

## 8. Audience Builder — safety through clarity

Move meaningful audience creation/editing from `AudienceEditor` slideout to the agent's full-page **Audience & Delivery** section, reusing validated existing rule logic.

- Choose company members, contact segments/rules, specifically selected contacts, or trigger contact as allowed by the agent type.
- Display a human-readable **recipient rule summary** and preview count.
- Show 3–5 *sample matches* only when safe/permitted. Avoid dumping private customer addresses into broad surfaces.
- State the difference between **matching contacts**, **eligible email recipients**, and **actual sent/delivered count**.
- Explicitly show if no recipients match or email connection is not ready.
- Preserve existing invariant: clearing the last condition **does not silently expand to all contacts**. Require explicit consent to "All eligible contacts".
- Recompute/count before activation; acknowledge counts change between configuration and delivery.
- Offer a safe preview for schedule + audience + sender in one summary before activation.

## 9. Schedule Builder — readable, timezone-safe, trustworthy

Give scheduling equal polish to content composition.

**Modes:** Manual/on-demand, Recurring schedule, Business event trigger — subject to supported agent type.

A recurring schedule page must show:
- Local timezone (company default, overridable only if supported)
- Repeat rule summarized in human language
- Time of day / weekdays / interval / relevant date constraints
- Next **three** projected occurrences where backend scheduling supports reliable calculation
- Pause/resume state and whether next run is queued
- DST implications and missed-run behavior (document actual implementation; do not invent guarantees)

A trigger-based agent must show the business event, eligibility rules, delay/cooldown if supported, and an example condition.

Separate **when the agent is eligible to fire** from **when delivery actually completed**. Run history should show scheduled time, attempted time, final outcome and retry status if tracked.

Changes to schedule need clear saved/live semantics and should not accidentally trigger immediate sends.

## 10. Monitoring and recovery

The feature must be trustworthy after activation, not just easy to set up.

**Agent landing attention view:** Needs sender reconnect, invalid audience, failed run, missing channel, paused. Use status-specific plain-language fixes; allow deep link to exact offending section.

**Global activity:** Filter by agent, status, date, channel. Keep current event history and pagination. Allow event drilldown with timestamps, outcome, failure summary, recipient summary and links back to source agent.

**Notifications:** Notify authorized owners on meaningful failures or disabled integrations; avoid spam and do not expose private recipient details in general notification surfaces.

**Operational actions:** Pause/Resume prominent; retry/re-run only when idempotency, permissions and duplicate-send safeguards are established and tested. Do not add a generic "Retry" that could email people twice.

## 11. Native-quality interaction contract

- Agent/section navigation operates without full app reload and preserves scroll, field focus and position.
- `Cmd/Ctrl+K`: search "schedule email", "create agent", "customer report", and existing agents.
- `Esc`: close popovers/menus, not discard a substantive agent draft.
- Inputs update immediately; network errors are surfaced nearby, not only in transient toasts.
- Stable split pane, resize grip keyboard-operable if implemented; respects minimum widths and reduced-motion preference.
- Tooltips and empty states explain consequences rather than repeat labels.
- Preview updating does not steal focus or reinitialize the text input.
- Tricky async stages show status: saving, previewing, validating, testing, activating, sending.
- Focus return is deterministic from modal confirmations, test-send flow and company integration detours.
- Autosave conflicts or concurrency must not silently overwrite another editor's changes.
- Avoid user-facing raw cron expressions, provider jargon, unexplained status codes or tiny all-caps control text.

## 12. Migration plan — contained, reversible increments

**Phase A — Verify existing behavior (no redesign).**
Map routes, all existing agent types, API contract, sender providers, schedule rules, preview behavior, save/activation semantics, permissions. Record browser walkthroughs. Build feature-parity checklist.

**Phase B — Discoverability quick win.**
Choose and test label; add contextual launch actions, global search synonyms, intelligible empty state, high-signal landing copy; improve list default columns and attention filter. No backend change.

**Phase C — Collection adoption.**
Move `AgentsDesk`/`AgentList` to universal table/page contract. Preserve list filters, actions, URL semantics, event history and company scope.

**Phase D — Full-page item and creation.**
Route agent, catalog, audience, scheduling and creation through `ItemWorkspace` and `CreatePage`. Migrate substantial `AudienceEditor` slideout work to a page section. Keep light confirmations only.

**Phase E — Email Studio.**
Refactor layout into content/design/preview regions; reuse current rendering pipeline; introduce test-send confirmation and visible save/activation status. No email infrastructure rewrite.

**Phase F — Monitoring, onboarding and regression.**
Add attention/resolution affordances, deep links, informative summaries; test keyboard, themes, company switch, roles, responsiveness and reliability.

Each phase must ship independently behind flags where appropriate; rollback must not lose existing agent records/configuration or alter delivery schedule unpredictably.

## 13. Developer-facing component mapping

| Existing | Target responsibility | Strategy |
|---|---|---|
| `AgentsDesk` | Entry orchestration and canonical routes | Thin route/container; stop owning bespoke page chrome |
| `AgentList` | `CollectionWorkspace<Agent>` adapter | Preserve data fetching, filters/actions; share table and toolbar |
| `AgentCatalog` | Full-page create intent/template picker | Better use-case selection, preserve prefab IDs and creation API |
| `AgentEditor` | `ItemWorkspace` + structured sections | Extract controls incrementally; preserve mutations/validation |
| `AudienceEditor` | Audience section with existing rule engine | Rehouse substantial workflow; preserve match-count safeguards |
| `AgentRiver` | Global/agent activity list | Shared collection and history anatomy, preserve event API |
| `EventDetail` | Standard run detail item | Preserve results, permissions and deep links |
| `IntegrationsSection` | Company-authorized sender management | Deep-link into connection setup, preserve return path |
| Current iframe preview | `MessageStudioPreview` | Preserve sandbox and server-rendered content |

Suggested boundaries (illustrative, not mandates):
```
features/agents/
  AgentsCollectionPage.tsx
  AgentItemPage.tsx
  AgentCreatePage.tsx
  AgentOverview.tsx
  AgentAudienceSection.tsx
  AgentScheduleSection.tsx
  AgentHistory.tsx
  studio/
    MessageStudio.tsx
    ContentPanel.tsx
    DesignPanel.tsx
    PreviewPanel.tsx
    TestSendDialog.tsx
```
Do not introduce a new universal backend `Entity` table or migrate all agent state at once.

## 14. Acceptance journeys — required E2E tests

1. **Discoverability:** new user can find "scheduled email" from company landing/global search without knowing term "agent"; visible option to create.
2. **Prefab creation:** choose customer report → draft created → correct editing sections shown; no inadvertent activation.
3. **Sender unavailable:** disconnected sender is flagged; follow Integration link; return to same draft with content intact; cannot activate with invalid sender.
4. **Content composition:** change subject/body, template, theme, dynamic section; preview updates correctly and input focus/scroll is stable.
5. **Recipient safety:** edit segment; see computed estimate; clearing last rule does not silently broaden to all customers.
6. **Test-send safety:** explicitly enter/confirm test destination; only that destination receives test; production audience unchanged.
7. **Schedule correctness:** schedule recurring agent with timezone; human readable summary and next run agree with backend; edit/pause/resume preserves planned behavior.
8. **Activation gating:** invalid sender/audience/content cannot activate; fully configured draft can activate with review confirmation.
9. **Monitoring:** find a previous failed run, understand reason, navigate directly to relevant fix and return to history.
10. **Tenant/permission isolation:** cannot access another company's agents, senders, previews, recipients or events; non-editor cannot publish.
11. **History and return context:** switching to company Integrations or global activity returns to same agent/section with drafts intact.
12. **Regression:** existing email+chat agents, triggered flows, template rendering, social-capable types, SMTP/Gmail/platform sender paths where deployed all behave as before.

## 15. UX quality metrics and target gates

**Suggested targets, validate with baseline first:**
- New user identifies the scheduled-email entry within 10 seconds in moderated usability testing.
- From company overview, start a new customer-report draft in ≤3 meaningful interactions.
- Agent health, next run and configured sender recognizable without entering edit mode.
- Zero unintended send events across automated browser tests.
- No destructive state loss on navigation, reload (where draft persistence is supported), connection detour or network error.
- Keyboard-only workflow works for navigation, writing, preview choice, scheduling and publication.
- No horizontal page-level scroll at ordinary desktop widths; split editor adapts to laptop and mobile.
- Visual and interaction parity under at least light, dark and deliberately extreme themes.

## 16. Decision register — resolve before coding the final polish

**Needs product decision**
1. Customer-facing label: `Automations` vs `Messages & Automations` vs `Agents` (recommend `Automations`, preserve "Agents" in technical model).
2. Active-agent editing model: immediate live update vs separate draft/published revision (safety-critical; verify existing server semantics).
3. Whether full-page `Message Studio` is an item section or nested route (recommend nested route if meaningful design complexity).
4. Which social and external email provider flows are truly available for launch.
5. Whether test sends can use arbitrary validated recipient or only owned addresses (follow current policy + security review).

**Do not block initial migration on**
- Drag-and-drop email builder
- Custom HTML mode
- Multiple A/B templates
- Marketing analytics suite
- Redesigning email delivery infrastructure
- New native mobile application

## 17. Developer kickoff instruction

> Audit current 8080 Agents, email template/preview generation, sender connection authorization, audience safety, scheduling, save/activation, and event history against this addendum and the main redesign plan. Capture actual browser workflows and reconcile every assumption. Implement incrementally: first discoverability/landing clarity, then shared collection and item anatomy, then full-page agent creation and Audience/Schedule sections, then an immersive Email Studio using existing preview/rendering/sending APIs, then monitoring and accessibility polish. Do not alter delivery semantics, risk sending email unexpectedly, remove prefab capabilities, or broaden audiences. For every phase provide a before/after map, test coverage, screenshots, regressions, commit identifiers, and a concise list of product decisions needed.
