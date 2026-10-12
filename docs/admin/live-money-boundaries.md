# Premium monetization: Live money boundaries

Implemented 2026-10-12 as a disabled cost-control foundation. This does not launch Premium, enable checkout, connect a provider account, or enable Live.

## Scope and ownership

A person's allowance applies across every workspace and room they can access. Workspace membership continues to authorize access; it does not own or reset the allowance. A separate platform ceiling bounds aggregate reservations across all users. Staff status does not bypass either budget. Workspace-sponsored allowances can be a separate product later, with an explicit payer and ledger; they are not implicit in this design.

The foundation uses UTC daily accounting windows and integer USD microdollars (1 USD = 1,000,000 microdollars). This is an internal provider-cost window, not a selected Premium price, monthly customer allowance, or billable customer balance. Actual numeric limits and the provider rate model remain undecided. Database defaults are **stopped**, with zero budgets and concurrency. There is no public configuration/resume endpoint.

## Implemented

`services/live/costLedger.ts` provides server-internal reservation, dispatch, release, unknown-cost marking, and settlement functions. Neither clients nor admins can submit a cost estimate or settlement through HTTP.

- A native write locks one durable policy row before any transaction reads. All instances using this database share it. Personal and platform exposure are checked in the same transaction as reservation creation; no process-local counter authorizes spending.
- Reservations have a unique request key tied to the user, room, amount, and deadline. Exact retries return the original row; changed reuse is rejected. Returning an existing reservation never authorizes another provider call.
- A separate dispatch transition commits before any future provider request. Only one caller can claim it. The stop state, account status, Premium, and deadline are rechecked. A retry cannot dispatch the same reservation twice.
- Unresolved reservations consume both money capacity and concurrency. Expiration does not free either. Unknown liabilities survive UTC day rollover.
- Only never-dispatched reservations can be released without evidence. Dispatched or unknown work needs verified settlement evidence, including a verified zero-cost result.
- Settlement writes the entire actual cost, releases the estimate, keeps the original accounting period, and creates an audit event. Repeated identical evidence is idempotent; conflicting settlement or reused evidence is rejected.
- An actual cost above the estimate, personal ceiling, or platform ceiling latches the stop. The ledger never clips an overrun to the budget or silently discards the debt.
- Reservations and policy have no user/room cascade, so deleting application content cannot erase an unresolved liability.

| State | Money held | Concurrency held | Allowed next operation |
| --- | --- | --- | --- |
| reserved | Full estimate | Yes | Dispatch, release before dispatch, or mark unknown after deadline |
| dispatched | Full estimate | Yes | Settlement or mark unknown after deadline |
| unknown | Full estimate, even across days | Yes | Evidence-backed settlement |
| settled | Actual cost in original period | No | Identical settlement retry only |
| released | None | No | Identical release retry only |

## Operator control

Settings has a small **Live spending control** section; no new administration screen or dashboard. Staff can view whether new spending is stopped and the number of unresolved expired reservations. Owners can stop new reservations/dispatches with confirmation, reason, CSRF protection, and an expected policy version. The action is audited. The UI deliberately has no resume control and no claim that existing provider sessions have been disconnected.

Endpoints:

- `GET /admin/live-costs`: staff-only policy status, amounts encoded as decimal strings, unresolved count.
- `POST /admin/live-costs/stop`: owner-only, `{expectedVersion, reason, confirmed: true}`.

The independent `liveToken` launch gate still refuses every account. Even changing the ledger policy directly cannot enable Live. The reservation functions are not wired into token minting because there is no enabled minting path. Their future caller must enforce room/workspace access immediately before admission as well as the reservation checks.

## What still blocks Live launch

1. Choose the actual personal/platform budgets, session duration, and concurrency limits. Define a versioned, conservative provider quote covering every enabled cost dimension (participant connection time, bandwidth, and any recording, ingress, egress, agents, or storage). Unbounded capabilities must remain unavailable.
2. Connect the admission adapter: reserve, mark dispatch, then mint one bounded credential with a unique session identity. Never retry a provider side effect merely because the response was lost.
3. Add a durable worker that stops/removes participants at their deadline and when a stop or suspension occurs. A database deadline is not a provider disconnect. Token expiry alone is not a session-duration control.
4. Verify signed LiveKit events, bind them to the reservation/session, deduplicate them, and reconcile missing/late events against the provider. Join/leave events are not automatically a complete provider invoice or cost quote. Use measured pricing evidence for settlement; do not treat an absent callback as zero cost.
5. Run the unknown-state sweep and provider reconciliation on a durable schedule. The internal sweep is implemented but not scheduled while Live is closed. Status still counts expired outstanding reservations as unresolved, and their holds remain enforced even if the sweep has not run.
6. Support append-only provider corrections after final settlement before relying on invoice reconciliation. Current settlement deliberately rejects changes to a finalized amount; do not overwrite it manually.
7. Validate provider cut-off behavior, cross-instance operation, emergency removal, and recovery in the actual LiveKit environment before enabling admission. The current admission stop cannot terminate external sessions created outside this ledger.

LiveKit explicitly does not guarantee webhook delivery, so reconciliation is a launch requirement, not optional reporting. See [LiveKit webhook delivery and verification](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) and [participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

## Migration and verification

Apply [003-live-cost-ledger.sql](migrations/003-live-cost-ledger.sql) once, after the previous admin migrations. It was applied only to local `voice_chat_dev` and `voice_chat_test`. No production database, provider account, price, or running session was changed.

```sh
pnpm --filter @project/db exec prisma db execute --file ../../docs/admin/migrations/003-live-cost-ledger.sql --schema prisma/schema.prisma
pnpm --filter @project/db generate
pnpm --filter server exec vitest run src/__tests__/liveCosts.test.ts src/__tests__/live.test.ts src/__tests__/adminSync.test.ts
pnpm --filter web exec node tests/admin.mjs
```

The tests exercise real database transactions competing for reservations, global/personal money and concurrency ceilings, idempotency, deadline uncertainty across periods, settlement evidence, overruns, emergency-stop authorization, and unchanged Live denial. Browser fixtures cover stop confirmation/cancel, disabled state afterwards, and mobile layout. Provider calls are neither made nor simulated as actual billing evidence in these ledger tests.

## Other monetization tracks

Staff MFA and real Stripe test-account verification remain the next operational-safety tasks. Pricing and checkout remain disabled by explicit instruction. Persistent Blueprint moderation and actual paid capability delivery remain separate work; browser-local studio actions do not become publication authority. AI token spending also requires its own durable budget; this Live ledger does not silently replace the assistant/router controls.
