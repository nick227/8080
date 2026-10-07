# Agents Management — Requirements and Phased Delivery

## V1 product goal

A workspace user can:

1. create an Agent from a built-in type,
2. edit its message content,
3. change Template and Theme independently,
4. select a simple Contact audience,
5. configure a small type-specific set of rules,
6. send a test,
7. publish the Agent,
8. see upcoming activity,
9. see completed/failed activity forever in the Agents river,
10. open an activity event to inspect exactly what happened.

## V1 non-goals

Do not build:

- general visual workflow builder,
- arbitrary branching logic,
- generic condition language,
- campaign object,
- separate Runs top-level UI,
- separate Library top-level UI,
- advanced audience builder inside Agents,
- automatic AI execution-time writing,
- hidden retry engine,
- analytics dashboard,
- A/B testing,
- deliverability optimization,
- multi-step compliance automation,
- social inbox,
- reply handling,
- SMS in the first email slice.

## Phase 1 — Email Agent shell

Build:

- Agents home
- active/draft Agent cards
- activity river
- Add Agent
- Agent editor shell
- Template selector
- Theme selector
- plain-text email
- basic HTML email
- one visually distinctive HTML template
- Send test
- Draft / Active / Paused lifecycle

Recommended first Agent types:

- Company newsletter
- Company announcement
- Welcome a new customer

These exercise:

- recurring schedule,
- manual one-time email,
- contact-event follow-up.

## Phase 2 — Message queue and scheduling

Build:

- N AgentMessages
- EMPTY / DRAFT / READY
- recurring monthly schedule
- exact one-time scheduling
- wait-N-days follow-up
- next-event calculation
- late recipient binding
- duplicate suppression
- blocked state when no READY content exists

## Phase 3 — Email execution

Build:

- provider adapter
- scheduled executor
- AgentEvent
- AgentEventTarget
- frozen rendered payload
- visible progress
- visible failures
- bounded, visible retries of transient errors only (07 decision 7)

## Phase 4 — Remaining email Agent types

Add the remaining built-in email Agents once the shared behavior is proven.

Disabled types should not appear active until their source events exist.

Examples:

- no-reply follow-up requires reliable reply/inactivity semantics,
- post-service follow-up requires a service-complete event.

## Phase 5 — Social with minimal blast radius

Reuse:

- Agent
- AgentMessage
- Template
- Theme
- AgentEvent

Add:

- social ChannelConnections,
- destination capability checks,
- post-specific content fields,
- social scheduled/manual built-in Agent types.

Do not fork a separate social automation system.

## Cross-surface integration

### Calendar

Calendar can display AgentEvents.

Labels should describe automated behavior:

- Auto-emailing 44 review requests
- Auto-posting company update
- Auto-emailed 42 customers · 2 failed

Clicking opens the matching Agent/event.

### Contacts

Contacts owns list organization.

Agents may consume simple Contact groups/statuses.

Contacts may later expose shortcuts to begin a Manual Agent or enroll selected contacts into supported behavior.

### Inventory

Inventory may provide merge/reference data to selected Agent types.

Examples:

- sales catalog,
- new product/service,
- product/service spotlight.

Inventory remains authoritative for product facts.

## AI requirements

Every AI call follows the minimum-context architecture:

- one bounded job,
- declared input fields,
- record cap,
- token ceiling,
- no internal database IDs,
- no permissions or state management,
- no send/publish side effect.

For Agents, AI is primarily a writing helper.

The saved Agent must be explicit structured state that code can execute without further AI interpretation.

## Acceptance standard

The feature is successful when a normal business user can create and publish a common communication Agent without understanding automation terminology.

The common path should feel closer to configuring five obvious controls than building a workflow.
