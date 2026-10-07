# Agents Management — Proposed Schema

This is a design proposal, not a requirement to expose every concept in the UI.

## Agent

Represents one user-configured instance of a built-in Agent type.

```text
Agent
- id
- workspaceId
- typeKey
- family
- name
- status              DRAFT | ACTIVE | PAUSED | ARCHIVED
- channelKind         EMAIL | SOCIAL
- channelConnectionId
- recipientConfig     JSON
- ruleConfig          JSON
- templateId?
- themeId?
- createdByMemberId
- createdAt
- updatedAt
- publishedAt?
```

Notes:

- `typeKey` refers to registered built-in behavior, e.g. `company_newsletter`.
- `recipientConfig` is bounded and type-specific.
- `ruleConfig` is bounded and type-specific.
- Do not store executable code or arbitrary expressions.
- Built-in Agent handlers validate their own configs.

## AgentMessage

One piece of content owned by an Agent.

```text
AgentMessage
- id
- agentId
- position
- title
- status              EMPTY | DRAFT | READY
- subject?
- contentJson
- plainText?
- templateId?
- themeId?
- createdAt
- updatedAt
```

Use cases:

- Scheduled newsletter Agent with N future messages.
- Drip-like Follow-up Agent later with N ordered messages.
- Manual Agent with one reusable message.

`contentJson` should hold semantic content rather than raw provider-specific HTML where practical.

## Template

A reusable structural layout with starter content.

```text
MessageTemplate
- id
- workspaceId?        null for built-in
- channelKind
- key
- name
- category
- structureJson
- starterContentJson
- isBuiltIn
- createdAt
- updatedAt
```

Templates may be built-in or workspace-defined later.

## Theme

Reusable presentation tokens.

```text
MessageTheme
- id
- workspaceId?        null for built-in
- key
- name
- tokensJson
- isBuiltIn
- createdAt
- updatedAt
```

Example token families:

- typography
- colors
- logo placement
- button treatment
- spacing
- background
- border/radius

Themes should be reusable across Agent types.

## AgentEvent

One concrete past or future action of an Agent.

```text
AgentEvent
- id
- workspaceId
- agentId
- messageId?
- kind                EMAIL_SEND | SOCIAL_POST
- status              SCHEDULED | RUNNING | COMPLETED | FAILED | CANCELED
- scheduledFor
- startedAt?
- completedAt?
- recipientCount?
- successCount?
- failureCount?
- frozenPayloadJson?
- failureSummary?
- createdAt
- updatedAt
```

This replaces the need for a user-facing "Run" object.

The UI calls these activity/events, not necessarily `AgentEvent`.

## AgentEventTarget

Optional per-target detail for multi-recipient delivery.

```text
AgentEventTarget
- id
- agentEventId
- contactId?
- externalTargetKey?
- status              PENDING | SENT | FAILED | SKIPPED
- renderedPayloadJson?
- providerMessageId?
- failureCode?
- failureMessage?
- sentAt?
```

For social posts there may be one target per connected page/account.

## ChannelConnection

Channel setup is handled separately from Agents.

```text
ChannelConnection
- id
- workspaceId
- providerKey
- channelKind
- displayName
- status
- authRef
- capabilitiesJson
- createdAt
- updatedAt
```

Agents reference a connection; they do not own credentials.

## Contact suppression

Duplicate suppression should be deterministic.

Minimum rule:

- before creating a concrete email target, check whether the same Agent/message/contact is already scheduled or successfully delivered inside the relevant Agent-defined dedupe window.
- duplicates become `SKIPPED`, not a second send.

Do not rely on AI for dedupe.

## Late binding

For scheduled email:

- Agent/message remain editable until a short pre-execution cutoff.
- recipient resolution and merge-variable rendering happen shortly before execution.
- the resulting `AgentEvent` and target payloads are frozen once execution begins.
- no version tree is required for V1.

## Deletion

Prefer archival over destructive deletion for published Agents with history.

Draft Agents with no history may be deletable.
