# Admin use cases and money boundaries

Reviewed 2026-10-12 against the implemented Users, Billing, Settings, and Blueprint screens.

| Use case | Current behavior | Remaining decision or work |
| --- | --- | --- |
| Help a Free user try Premium | Expiring personal grant, before/after preview, confirmation, reason, audit | Premium currently has limited benefits; do not sell unfinished Live, ad removal, or blueprint gating |
| Revoke complimentary access | Revoke one or all active/scheduled grants; preserve paid access | None for this slice |
| Stop abusive access | Suspend account, revoke login sessions, disconnect streams; preserve billing history | Staff must separately decide whether to cancel/refund in Stripe |
| Restore an account | Reactivate account without changing workspace roles or renewing expired grants | None for this slice |
| Identify who pays | Exact, owner-confirmed customer binding; metadata shown only as a hint | Reassignment/multiple customers require a future support workflow |
| See payment trouble | Subscription and latest invoice status separately, last sync in user detail, links to Stripe | No collections emails, payment method editing, or dunning UI |
| Grant access after payment | Signed event → current Stripe read → local subscription → personal entitlement | Actual restricted key, webhook destination/secret, and Premium Price IDs still required |
| Handle duplicate/late events | Signature check, transaction lock, durable receipt, fetch latest state, atomic audit | Queue and scheduled reconciliation when volume warrants them |
| Recover missed events | Owner-confirmed **Reconcile access**; Stripe retries failed deliveries | No automatic full-account reconciliation yet |
| Cancel/refund/change price | Open Stripe record; app sends no billing writes | Checkout/pricing explicitly undecided; refunds/disputes policy still required |
| Appoint staff | Owner-only Settings actions; version check, no self-role edits, preserve an owner, audit | Staff MFA remains a production launch prerequisite |
| Change workspace membership | User detail shows membership and role; existing workspace policy retains authority | No platform override UI; a platform role must not silently confer workspace authority |
| Control Live costs | Token issuance blocked; durable personal/platform reservations and an owner admission-stop control now exist | Wire verified provider pricing, removal workers, scheduling, and reconciliation before enabling; see [Live money boundaries](live-money-boundaries.md) |
| Inspect Live usage | No report, as explicitly deferred | Meter and reconcile provider usage before opening Live; account for existing provider sessions at cutover |
| Control AI token spend | Existing assistant/router feature switches and call/spend estimates are separate from Premium | Durable cross-instance reservations, clear allowance ownership, and admin visibility before promising paid AI quotas |
| Approve a blueprint | Moderation is a browser-local simulation (local storage), with publication and validation claims corrected | Persisted moderation, publication authorization, and protected delivery remain unimplemented |
| Remove advertising for Premium | Personal entitlement source is available | Ad placements and enforcement are not implemented |

## Important distinctions

**Premium is not a workspace role.** A paid or complimentary entitlement follows the person. It does not grant entry to a workspace, grant its capabilities, or upgrade teammates. A platform admin does not become a workspace administrator automatically.

**Suspension is not cancellation.** Suspension blocks application use and ends sessions; the Stripe subscription continues. The confirmation states this. Complimentary grants never create a charge; grant revocation never cancels Stripe.

**A subscription is not proof of payment.** Paid access requires a linked customer, an allowlisted recurring Premium price, active status, and a paid invoice for the same subscription/customer/mode. Trialing, past-due, missing invoice, and paused collection are ineligible. This is the initial conservative policy while checkout is disabled, not a promise about future trials or grace periods.

**Token categories differ.** LiveKit admission tokens authorize a billable media capability; authentication tokens authorize account access; AI tokens measure model consumption. The same subscription status must not be treated as a blanket permission to mint credentials or spend an unlimited provider budget.

## AI cost findings

The code already logs assistant calls (`bots/assistant/calls.ts`) and shadow routing (`bots/ai/shadow.ts`) with token counts and estimated USD where the provider supplies usage. Environment configuration sets call caps and spend thresholds, and individual assistant jobs set input/output ceilings. These are useful controls, but their in-flight reservations are process-local, while cost totals are checked before a call and written afterwards. Concurrent workers and calls with missing usage can exceed an apparent spend threshold. These are not a durable global money ledger or per-user Premium allowances.

This slice does not change AI behavior or advertise AI as a Premium benefit. A future money-control slice should reserve bounded cost in durable storage before provider dispatch, settle measured usage afterwards, retain unknown-cost attempts, and expose a small operational view and emergency stop. No dashboard charts are needed.

## Launch boundary

The application still creates no Stripe prices, checkout sessions, charges, refunds, or cancellations. Both checkout and Live remain disabled by explicit product decisions. The code path for billing synchronization is tested against signed fixtures and mocked Stripe responses; a real account integration still needs provider configuration and an end-to-end test. Staff MFA, live billing recovery, and actual paid feature delivery are prerequisites to selling recurring Premium.
