# Business triggers and customer-email exclusions

## Durable signals

`AgentBusinessEvent` stores workspace/contact-scoped business facts. Producing a fact and its eligible Agent events occurs in the same database transaction as the source change. Unique source keys and Agent occurrence keys prevent repeated deliveries from event replay. Agents must be active and published before the fact occurred; publishing does not backfill historical events.

- Entering a pipeline stage whose kind is `won`, or adding the `Customer` category, produces `became_customer` for `welcome_new_customer`. Label-only edits and repeated assignments do not trigger a welcome. Customer classification remains deterministic, with no AI inference.
- A contact's pipeline stage changing produces `stage_changed` for `followup_status_change`. Both individual and bulk contact updates produce the fact.
- Logging outreach produces `outreach_sent`. `checkin_no_reply` schedules one contact-specific follow-up after the configured `noReplyDays` (default 7). Before freezing recipients it verifies there is no later outreach/reply and that the original `lastContactedAt` has not been changed or retracted.
- `job_completed` produces `ask_for_review` and `checkin_after_service` runs. A job reference is unique within its workspace. It is not inferred from a won sale or a client-local calendar checkbox.

The current calendar is client-local and there is no canonical job or inbound-email system. Those producers can record audited facts through:

`POST /workspaces/{workspaceId}/agent-business-events`

```json
{
  "contactId": "contact-id",
  "kind": "job_completed",
  "sourceKey": "unique-source-event-id",
  "jobId": "job-reference",
  "occurredAt": "2026-10-08T15:00:00Z"
}
```

This authenticated endpoint requires contact write access and accepts `outreach_sent`, `reply_received`, or `job_completed`. It checks workspace ownership and active-contact status. Retrying an identical `sourceKey` returns the original result. Conflicting reuse fails. Stage/customer facts are produced through contact mutations, not arbitrary client claims.

Follow-up Agents no longer schedule periodic runs with empty trigger context. `ruleConfig.trigger` stores `delayDays` (0–365, default 0), `noReplyDays` (1–365, default 7), and optional destination `stages`. The editor exposes the applicable delay. Existing trigger occurrences retain their scheduled time when rules change. Pausing cancels pending trigger runs; completing one run never deletes other pending contact events. Delayed stage-change runs cancel if the contact has moved again.

## Mandatory exclusion layer

Audience matching remains one predicate compiler shared by preview, Contacts, and execution. Exclusion is a separate delivery gate; it does not rewrite audience rules. AND rules and OR values within each field remain the only grouping model. Unknown keys, OR groups, empty rule arrays, and invalid attribute rules fail closed.

After matching and before freezing rendered email targets, the runner checks `AgentEmailSuppression` by workspace and trimmed/lowercase email address. Manual exclusions, bounces, complaints, and unsubscribe choices block all customer-facing Agents for that address, including duplicate contact records. Blocked recipients appear as skipped (`SUPPRESSED`) without a rendered message. Team-member email and company chat are separate destinations/audiences and are unaffected.

Before each delivery attempt, including frozen retries, suppression is checked again. The frozen audience and address never change, but a later unsubscribe prevents another attempt. Preview/Contacts counts describe audience matches, not guaranteed sendable addresses; delivery history records excluded addresses.

Every customer email includes an unsubscribe link and List-Unsubscribe headers. The random token is stored only as a SHA-256 digest. GET shows a confirmation page and has no consent side effect; POST records the workspace-wide exclusion idempotently, including one-click form posts. Links continue to work after a contact is edited or deleted.

Authenticated management endpoints:

- `GET /workspaces/{workspaceId}/agent-suppressions`
- `POST /workspaces/{workspaceId}/agent-suppressions` with `{ "address": "person@example.com", "reason": "manual" }` (also `bounce` and `complaint`). Requires Agent-management access.

Automatic provider bounce/complaint webhooks are not connected yet; integrations can submit those exclusions through this authenticated endpoint. No automatic re-subscribe path exists.

## Configuration and rollout

Apply the Prisma schema before running this version (three new tables). The local development and separate test databases were updated without data-loss overrides. Other environments require the normal schema rollout.

Production customer sending requires `PUBLIC_API_URL` set to the externally reachable HTTPS API origin. Publishing and target preparation fail closed if this is missing or invalid. Development defaults to localhost; do not use localhost unsubscribe links for real customer sends.

All production contact-creation paths (Contacts, imports, CRM notes) now select the workspace's first active open pipeline stage. The standard database fallback is `contacted`, matching the standard seeded pipeline. No active open stage produces an explicit error. Existing records with orphaned legacy stage keys are preserved: pipeline initialization adds their missing vocabulary definitions instead of relabeling the contacts.

## Verification

`agentBusinessTriggers.test.ts` covers contact and bulk transitions, atomic/stale updates, job/reply/outreach replay, no-reply cancellation, workspace isolation, independent pending events, unsubscribe confirmation and one-click POST, mandatory exclusions, retry suppression, pipeline defaults, and fail-closed configuration. Existing audience, Team, and SMTP suites cover the adjacent execution paths.
