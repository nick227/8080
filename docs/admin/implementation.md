# Users, Billing, and Settings — implementation and operation

Implemented 2026-10-11. The first slice adds `/admin` Users, platform authorization, user-owned expiring Premium grants, suspension/reactivation, and transactional admin audit records. Workspace policy retains its existing roles and resource rules and now shares active-account checks with platform policy. A typed scope dispatcher is available in `services/authorization/index.ts`; existing workspace service callers retain the compatible `workspacePolicy.authorize` entry point.

## Current product behavior

- Free accounts cannot get LiveKit tokens, including viewers.
- **Premium Live is disabled at the user's explicit direction until limits are decided.** No route can issue a LiveKit token. A grant does not bypass this. The browser checks availability before opening a Live camera/screen capture or initializing a connection. Recorded posts are unchanged.
- Premium grants attach to User, never Workspace. Start/expiry/revocation are evaluated server-side, without waiting for a scheduled job.
- Users separates account status, personal Premium, billing, and workspace memberships. Grant history shows active, scheduled, expired, and revoked grants (latest 50, with a total count). Available actions are computed server-side for the current staff member.
- Confirmations load a server-calculated before/after preview. They cannot submit while the preview is missing, loading, or failed. Shorter overlapping grants do not reduce/extend a later active expiry. Revocation supports one selected grant or all active/scheduled grants; expired history is preserved. Audit snapshots identify changed grant IDs and their dates.
- Confirmation requires a reason and the user version shown in the detail panel. A concurrent/stale change returns 409; reopen the dialog after refreshing. Each successful mutation and audit row commit together. Retries of the old confirmation cannot apply twice.
- Suspension deletes login sessions and closes the user's open SSE streams in the same process. Streams on other API instances check active account status every two seconds. Workspace content/resource access remains separate from staff status. An already in-flight request may finish; this is not a distributed cancellation protocol.
- Grant revocation only affects grants. Paid subscriptions are a separate source; previews and audit snapshots include paid access.
- `/admin` requires platform staff. Only owners can modify staff accounts, and self-suspension is forbidden. Owner protections and mutations are serialized by a database row lock. No staff roles are accepted through signup/profile/workspace APIs.
- Cookie-authenticated admin writes require a session-bound CSRF token and a trusted Origin; bearer clients use their explicit authorization token. Responses containing staff/user data use no-store.

Billing is implemented at `/admin/billing`; it shows an unconfigured state until a restricted Stripe key is supplied. Owners can reconcile local access from Stripe and manage staff in `/admin/settings`. Checkout remains disabled by the user’s explicit decision while pricing is undecided. Protected blueprint delivery, ad placements, editable Premium limits, and Live metering remain subsequent slices. Current public blueprint material remains public. Do not advertise complimentary Premium as delivering those unfinished benefits.

## Read-only Stripe Billing

Set `STRIPE_READONLY_KEY` in the **server environment**, using a restricted Stripe key configured with read access to subscriptions, invoices, and customers (customers are needed for explicit linking). Keep the key out of the frontend and chat. Restart the server after changing its environment. No key was available during implementation, so provider behavior was tested with mocked Stripe responses; a real account connection has not been verified.

The screen calls `GET /admin/subscriptions` with a bounded status filter and cursor. The backend checks `billing.read`, performs only a GET to Stripe's subscription-list endpoint, expands the latest invoice, and pins API version `2026-09-30.endive`. Full secret (`sk_`) keys are rejected, redirects are rejected, and requests time out after ten seconds. Upstream errors are sanitized. Listing subscriptions writes nothing. The separately confirmed reconciliation action updates local subscription records and entitlement state; it never writes to Stripe.

The UI separates subscription status from latest invoice status, labels test/live mode, shows retrieval time, and links to Stripe. Canceled subscriptions show an end date; subscriptions scheduled to cancel show an end rather than a renewal promise. For other subscriptions, the item period end is labeled as such; mixed intervals use the earliest item end. An unexpanded/missing invoice is unknown, never assumed paid. Stripe permissions still apply when opening Dashboard links.

An optional subscription metadata field `8080_user_id` associates a displayed record with an existing local user ID. Email is never used to infer a match; unknown/deleted users appear unlinked. This metadata hint is display-only and does not grant Premium. An explicit customer binding takes precedence and is labeled separately. The list covers the configured Stripe account's subscriptions; it does not imply every listed product is an 8080 Premium plan. Use the intended 8080 Stripe account/key. User detail shows the explicit customer binding and last synchronized subscription state, with timestamps.

References: [Stripe subscription list](https://docs.stripe.com/api/subscriptions/list), [API versioning](https://docs.stripe.com/api/versioning), [restricted keys](https://docs.stripe.com/keys).

Blueprint submission moderation is labeled as a browser-local demo. Simulating approval/rejection persists only in browser local storage; it does not publish to the site, send revision requests, or produce server audit events. Existing catalog and package-inspection work is preserved.

## Schema and startup

The first additive SQL is [001-users-admin.sql](migrations/001-users-admin.sql). Subscription synchronization adds [002-stripe-sync.sql](migrations/002-stripe-sync.sql), containing StripeCustomerBinding, StripeSubscription, and StripeWebhookReceipt. Both migrations were applied to the local development and dedicated test databases; neither was applied to production. It contains only this slice's changes, not unrelated schema edits in the checkout. It adds User.adminVersion and the PlatformStaff, PremiumGrant, AdminAuditEvent, and AdminMutationLock tables. Audit records have no cascading User foreign key.

Apply each migration once, in numeric order, to the intended database with the established operator database workflow, before running code that reads the new fields. For an existing database, from the repository root:

```sh
pnpm --filter @project/db exec prisma db execute --file ../../docs/admin/migrations/001-users-admin.sql --schema prisma/schema.prisma
pnpm --filter @project/db exec prisma db execute --file ../../docs/admin/migrations/002-stripe-sync.sql --schema prisma/schema.prisma
pnpm --filter @project/db generate
```

The command targets DATABASE_URL; verify the target before running it. MySQL DDL is not transactionally reversible as a group: if interrupted, inspect which statements ran rather than blindly replaying the file. Keep the additive columns/tables during application rollback. This is a reviewed standalone migration, not a complete Prisma migration-history baseline. A full production baseline remains launch work.

The dedicated test database was synchronized and tested. The local application database (`localhost/voice_chat_dev`) was checked and already contained this additive schema, so no application migration was needed. No production database or provider settings were changed. After explicit user authorization, `a@a.com` was bootstrapped as the initial platform owner in the local development database (audited; no Premium grant).

## Initial owner

Choose an existing, active, registered human account by its exact user ID, then run:

```sh
pnpm --filter server admin:bootstrap <user-id>
```

The command loads the root environment file, creates the first platform owner, increments their version, and writes a `staff.bootstrap` audit record. It refuses if any staff binding already exists. It does not grant Premium. Do not promote by email domain or first-login order. Owners manage subsequent staff assignments in Settings; self-role changes are forbidden.

Navigate to `/admin` using that account. Registered staff also see a link from their Account page. Guests and workspace owners/admins are denied unless separately given platform staff authority.

## Local mock users

Run the additive, repeatable seed from the repository root:

```sh
pnpm --filter server admin:seed
```

It creates 14 users labeled `[Mock]` and two isolated mock workspaces. Search `[Mock]` in Users. Registered fixture emails use `@admin-fixtures.example.test`; no shared passwords, sessions, or platform staff roles are created. Real accounts and their memberships are untouched. The seed is restricted to local `voice_chat_dev` / `voice_chat_test` databases and refuses production mode. Existing fixtures are preserved: rerunning never renews grants, reverses suspension, or restores changed memberships.

| Mock user | Account / Premium | Workspace example |
| --- | --- | --- |
| Alex Rivera | Active Premium | Owner in both workspaces |
| Jordan Chen | Free | Workspace admin, no platform staff authority |
| Samira Patel | Active Premium | Member in both workspaces |
| Theo Brooks | Free | Active member |
| Maya Okafor | Premium expires one day after seeding | Active member |
| Eli Morgan | Expired grant; Free | Active member |
| Noor Haddad | Revoked grant; Free | Active member |
| Lucas Silva | Future grant; Free until it starts | Active member |
| Priya Shah | Suspended account; Free | Active membership, overridden by account suspension |
| Owen Williams | Suspended account with a Premium grant | Premium does not bypass suspension |
| Ines Garcia | Active Premium | Suspended in one workspace, active in another |
| Kai Tanaka | Free | Removed workspace membership |
| Riley Davis | Free | No workspace membership |
| Guest visitor | Guest; Free | No workspace membership |

Grant dates are relative to the first seed run and continue to age normally. Seed creation is audited as `fixture.created`. Billing remains unconnected; no Stripe subscriptions or fake payment records are created. The older general `db:seed` script deletes data and should not be used to populate this admin demo.

## Production gate

Platform administration is off by default when NODE_ENV=production. `ADMIN_ENABLED=true` explicitly opens staff-authorized routes. Configure SESSION_SECRET and exact trusted CORS_ORIGIN values first. This flag is an operational gate. The POC/MVP enforces server-side role-based staff authorization (`platform_admin` / `platform_owner`) directly on every admin endpoint, allowing staff to enter `/admin` without mandatory TOTP MFA or 15-minute elevation. Dormant TOTP MFA infrastructure and schema are preserved in codebase and database for future production hardening. Do not deploy publicly accessible admin operations without appropriate safeguards, including strong authentication, audit logging, and protection against compromised sessions. No deployment was performed.

This change prevents new Live tokens; it does not reach into an already-running LiveKit provider project. Before a production cutover, drain existing Live rooms and invalidate old admission credentials using the actual provider's supported controls. Existing connected sessions can refresh their tokens; do not assume the former ten-minute token lifetime ends those sessions. Only reopen Live after personal budgets/concurrency limits and server-side removal are implemented and tested.

## Validation

- Server integration tests exercise actual stored sessions, platform/workspace scope isolation, CSRF, concurrent confirmations, suspension, grants, expiry, and Live denial.
- Existing workspace/auth tests cover policy compatibility.
- The current focused admin, billing, synchronization, seed, and Live suites total 49 passing server tests. Signed fixtures cover duplicate/late events, retries, invoice states, expiry, independent paid/grant access, stale confirmations, customer binding, and concurrent owner demotions.
- The browser fixture tests staff denial, search/detail, confirmation cancel, grant submission with CSRF, audit display, billing reconciliation, customer-link confirmations, owner-only staff changes, and desktop/mobile layout using the actual admin components with mocked network responses.
- OpenAPI/SDK drift and server/web/SDK TypeScript checks passed during implementation.

Run focused checks:

```sh
pnpm --filter server exec vitest run src/__tests__/admin.test.ts src/__tests__/adminBilling.test.ts src/__tests__/adminSync.test.ts src/__tests__/adminSeed.test.ts src/__tests__/live.test.ts src/__tests__/workspaces.test.ts src/__tests__/auth.test.ts src/__tests__/stream.test.ts
pnpm --filter web exec node tests/admin.mjs
pnpm sdk:check
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm --filter @project/sdk typecheck
```


## Subscription synchronization and recovery

Updated 2026-10-12. Configure these server-only values; no actual provider key or webhook secret was available during implementation:

- `STRIPE_READONLY_KEY`: restricted key for the intended account and mode, with read permissions for subscriptions, invoices, and customers.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the account’s snapshot event endpoint at `POST /billing/stripe/webhook`.
- `STRIPE_PREMIUM_PRICE_IDS`: comma-separated allowlist of recurring Stripe Price IDs that buy personal Premium. Empty by default: no paid Premium until the plan is decided. This does not enable checkout or create a price in Stripe.

Use a snapshot event destination for your own account (not Connect), pinned to `2026-09-30.endive`. Subscribe to `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, plus `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.marked_uncollectible`, and `invoice.voided`. Thin events are not supported by this endpoint. Keep API keys, webhook secrets, price IDs, and the destination in the same Stripe mode/account. In production, test-mode records never grant paid Premium.

The isolated Fastify route verifies the original request bytes with Stripe’s SDK, including signature age, before processing. Supported deliveries re-fetch the current subscription with its latest invoice, under the shared database lock, instead of trusting delivery order. A durable receipt, local subscription snapshot, user version, and audit event commit together. Concurrent duplicates are acknowledged once; failed fetches or database work roll back and return an error so Stripe can retry. The handler has a five-second provider timeout; it is a synchronous low-volume implementation, not a background queue.

The lock uses one native MySQL write as the transaction’s first statement. An emulated upsert can establish a stale repeatable-read snapshot before waiting; the native lock avoids that race for both admin changes and webhook delivery.

Owners link an exact `cus_` ID from a registered user’s Billing section after verifying ownership in Stripe. Linking validates the provider customer and requires the user’s current version, confirmation, and reason. It never matches by email and never imports a metadata hint as ownership. A customer and a user can each have only one binding; this UI does not reassign links. Previously synchronized data is not eligible until synchronized again after the link. Next, use **Reconcile access** on the subscription in Billing to backfill an existing subscription or repair a missed event. Recovery requires owner authority, confirmation, and an audit reason, and performs only provider GETs.

Paid Premium requires all of these:

- Explicit binding to the current account, matching the configured Stripe mode.
- Exactly one matching recurring Premium price item; incomplete item lists are ineligible.
- Active subscription, no paused collection, and an expanded paid invoice belonging to that subscription/customer/mode.
- A future item period end, capped by a scheduled cancellation date.

Trials, unpaid/open/missing invoices, overdue subscriptions, paused collection, and unrelated products do not grant paid access. There is no implicit grace period. Free/paid policy for trials and dunning can be revisited before checkout launches. A paid invoice can be zero-value (for example, a valid coupon); invoice state, not a positive amount, determines payment fulfillment. Refunds and disputes are not interpreted as subscription cancellations; those operations and decisions remain in Stripe/support policy.

Paid and complimentary sources combine without overriding each other. Revoking the last grant preserves paid Premium; canceling paid access preserves a still-valid grant. Expiry is checked on every entitlement read without a scheduler. Account suspension blocks use but never cancels recurring billing. Live remains disabled for all sources.

There is no scheduled full-account reconciliation yet. Watch failed deliveries in Stripe and use its event retries or the owner reconciliation action. A missed immediate cancellation can leave access until the last verified period end unless recovered sooner. Settings shows configuration and the last successfully processed event, not a claim that deliveries are healthy. No live account connection, charge, subscription creation, or deployment was performed.

## Staff administration

`/admin/settings` lists platform staff, billing readiness, and the deliberately disabled Live/checkout state. Only platform owners can appoint, promote, demote, or remove staff. Targets must be registered human accounts; suspended accounts cannot be appointed. Self-role changes are disallowed, an active owner must remain, and authorization is checked again inside the serialized mutation. Changes require the expected user version, confirmation, a reason, and CSRF protection for cookie sessions. Every successful change is audited. Roles do not confer workspace access or Premium.


## Live spending foundation

The disabled Live cost ledger and owner admission-stop control are described in [Live money boundaries](live-money-boundaries.md). Apply migration `003-live-cost-ledger.sql` before using the new Settings control. Defaults remain stopped with zero limits. This slice adds durable reservations and settlement interfaces; provider metering, removal, scheduling, and invoice reconciliation remain prerequisites to opening Live. Checkout is still disabled.
