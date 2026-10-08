# Recipient selection

Recipient identity is independent of sender identity and delivery destination. No AI participates in recipient selection.

## Configuration and defaults

`recipientConfig` uses four sources:

- `WORKSPACE_MEMBERS`: active members, using account email. Team reports, internal messages, and the current company-chat-only social templates have this intrinsic audience.
- `CONTACTS`: active, nondeleted, nonmerged contacts in the workspace, filtered when execution begins.
- `SELECTED_CONTACTS`: the explicitly selected contact IDs, scoped to the workspace and checked for active status again at execution.
- `TRIGGER_CONTACT`: the single `contactId` in the event context. Missing context fails with `MISSING_TRIGGER_CONTACT`; there is no fallback audience. Business events now produce these runs; see [business triggers and suppression](09-business-triggers-and-suppression.md).

Manual and scheduled customer-facing templates begin with empty TO (`{}` in storage, `null` in the API). Publishing and execution require a deliberate audience choice. Legacy customer templates containing `WORKSPACE_MEMBERS` also appear empty and cannot send until repaired. Selecting all contacts is an explicit checkbox in the modal. Removing the final chip clears TO.

```json
{
  "source": "CONTACTS",
  "filters": {
    "categories": ["Customer"],
    "stages": ["interested"],
    "location": ["Austin"],
    "tags": ["Pool cleaning"],
    "hasEmail": true,
    "attributes": [
      { "field": "potentialValue", "op": "gte", "value": 5000 },
      { "field": "lastContactedAt", "op": "before_days", "value": 30 }
    ]
  }
}
```

Rules combine with AND. Values within stages, categories, tags, assignedTo, or location combine with OR. Multiple independent OR audience groups are not implemented. Category and tag values are existing workspace tag names (the current Contacts model already represents categories as tags); location uses the structured `fieldValues.location` field. Assignment uses workspace membership IDs. Core attributes and active custom field definitions are allowlisted and type-checked. `before_days` uses a rolling 24-hour-day cutoff relative to resolution time and includes never-set values. `hasEmail` tests presence; invalid addresses remain visible delivery failures.

Unknown configuration keys, field names, and invalid operators/types are rejected. The API preserves unknown configuration properties until service validation, rather than silently stripping a misspelled filter and widening the audience.

## Shared resolution and UI

`contactAudience.ts` compiles workspace-scoped Prisma predicates shared by preview, delivery, and Contacts. `POST /workspaces/{workspaceId}/agent-audience/preview` returns contact matches, unique recipient count, and up to 100 sample contacts. The Agent editor exposes an editable rule-chip summary and opens the builder only on demand.

“View contacts” opens Contacts with the serialized audience in its `audience` query parameter. Contacts applies the same resolver before sorting/pagination and shows the active rule summary. The Contacts selection action opens the Agent catalog with selected IDs; choosing a customer-facing template creates a draft with that selection in one request.

## Execution

The runner resolves an audience once at preparation time, then freezes contact/membership IDs, email addresses and rendered messages. Membership, email, and rule changes after preparation do not change retries or historical runs. Contacts are deduplicated by ID, then valid email addresses are compared after trimming and lowercasing. Duplicate target rows are recorded as skipped, and missing/invalid addresses as failed. Email dedupe is scoped to the Agent occurrence, so later newsletters can reach the same address again.

Catalog types honor their configured, declared destinations. Email-only newsletters do not post to company chat. Team/internal chat delivery creates one workspace-channel target.

## Verification

- `pnpm --filter server exec vitest run src/__tests__/agentAudiences.test.ts`
- Existing Agent runner, Team, and SMTP tests.
- `pnpm --filter web exec node tests/agent-audience.mjs`
- Server/web typechecks and `pnpm sdk:check`.

The audience tests cover compound/custom filters, workspace boundaries, legacy defaults, explicit all/clear, selected and trigger contacts, preview/Contacts parity, duplicate email suppression, missing email, destination selection, and frozen retries.
