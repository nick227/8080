# Users and read-only Billing — implementation and operation

Implemented 2026-10-11. The first slice adds `/admin` Users, platform authorization, user-owned expiring Premium grants, suspension/reactivation, and transactional admin audit records. Workspace policy retains its existing roles and resource rules and now shares active-account checks with platform policy. A typed scope dispatcher is available in `services/authorization/index.ts`; existing workspace service callers retain the compatible `workspacePolicy.authorize` entry point.

## Current product behavior

- Free accounts cannot get LiveKit tokens, including viewers.
- **Premium Live is disabled at the user's explicit direction until limits are decided.** No route can issue a LiveKit token. A grant does not bypass this. The browser checks availability before opening a Live camera/screen capture or initializing a connection. Recorded posts are unchanged.
- Premium grants attach to User, never Workspace. Start/expiry/revocation are evaluated server-side, without waiting for a scheduled job.
- Users separates account status, personal Premium, billing, and workspace memberships. Grant history shows active, scheduled, expired, and revoked grants (latest 50, with a total count). Available actions are computed server-side for the current staff member.
- Confirmations load a server-calculated before/after preview. They cannot submit while the preview is missing, loading, or failed. Shorter overlapping grants do not reduce/extend a later active expiry. Revocation supports one selected grant or all active/scheduled grants; expired history is preserved. Audit snapshots identify changed grant IDs and their dates.
- Confirmation requires a reason and the user version shown in the detail panel. A concurrent/stale change returns 409; reopen the dialog after refreshing. Each successful mutation and audit row commit together. Retries of the old confirmation cannot apply twice.
- Suspension deletes login sessions and closes the user's open SSE streams in the same process. Streams on other API instances check active account status every two seconds. Workspace content/resource access remains separate from staff status. An already in-flight request may finish; this is not a distributed cancellation protocol.
- Grant revocation only affects grants. Stripe synchronization is not implemented yet, so there are no paid sources in this slice.
- `/admin` requires platform staff. Only owners can modify staff accounts, and self-suspension is forbidden. Owner protections and mutations are serialized by a database row lock. No staff roles are accepted through signup/profile/workspace APIs.
- Cookie-authenticated admin writes require a session-bound CSRF token and a trusted Origin; bearer clients use their explicit authorization token. Responses containing staff/user data use no-store.

Read-only Billing is implemented at `/admin/billing`; it shows an unconfigured state until a restricted Stripe key is supplied. Settings remains unavailable. Stripe checkout/subscription synchronization, protected blueprint delivery, ad placements, Premium plan settings, and Live metering remain subsequent slices. Current public blueprint material remains public. Do not advertise complimentary Premium as delivering those unfinished benefits.

## Read-only Stripe Billing

Set `STRIPE_READONLY_KEY` in the **server environment**, using a restricted Stripe key configured with read access to subscriptions and invoices. Keep the key out of the frontend and chat. Restart the server after changing its environment. No key was available during implementation, so provider behavior was tested with mocked Stripe responses; a real account connection has not been verified.

The screen calls `GET /admin/subscriptions` with a bounded status filter and cursor. The backend checks `billing.read`, performs only a GET to Stripe's subscription-list endpoint, expands the latest invoice, and pins API version `2026-09-30.endive`. Full secret (`sk_`) keys are rejected, redirects are rejected, and requests time out after ten seconds. Upstream errors are sanitized. No subscription or entitlement records are written.

The UI separates subscription status from latest invoice status, labels test/live mode, shows retrieval time, and links to Stripe. Canceled subscriptions show an end date; subscriptions scheduled to cancel show an end rather than a renewal promise. For other subscriptions, the item period end is labeled as such; mixed intervals use the earliest item end. An unexpanded/missing invoice is unknown, never assumed paid. Stripe permissions still apply when opening Dashboard links.

An optional subscription metadata field `8080_user_id` associates a displayed record with an existing local user ID. Email is never used to infer a match; unknown/deleted users appear unlinked. This association is display-only and does not grant Premium. The list covers the configured Stripe account's subscriptions; it does not imply every listed product is an 8080 Premium plan. Use the intended 8080 Stripe account/key. User detail does not claim a per-user billing status until durable customer linkage/synchronization exists.

References: [Stripe subscription list](https://docs.stripe.com/api/subscriptions/list), [API versioning](https://docs.stripe.com/api/versioning), [restricted keys](https://docs.stripe.com/keys).

Blueprint submission moderation is labeled as a browser-local demo. Simulating approval/rejection does not publish, persist, send revision requests, or produce admin audit events. Existing catalog and package-inspection work is preserved.

## Schema and startup

The additive SQL is [001-users-admin.sql](migrations/001-users-admin.sql). It contains only this slice's changes, not unrelated schema edits in the checkout. It adds User.adminVersion and the PlatformStaff, PremiumGrant, AdminAuditEvent, and AdminMutationLock tables. Audit records have no cascading User foreign key.

Apply the SQL once to the intended database with the established operator database workflow, before running code that reads the new fields. For an existing database, from the repository root:

```sh
pnpm --filter @project/db exec prisma db execute --file ../../docs/admin/migrations/001-users-admin.sql --schema prisma/schema.prisma
pnpm --filter @project/db generate
```

The command targets DATABASE_URL; verify the target before running it. MySQL DDL is not transactionally reversible as a group: if interrupted, inspect which statements ran rather than blindly replaying the file. Keep the additive columns/tables during application rollback. This is a reviewed standalone migration, not a complete Prisma migration-history baseline. A full production baseline remains launch work.

The dedicated test database was synchronized and tested. The local application database (`localhost/voice_chat_dev`) was checked and already contained this additive schema, so no application migration was needed. No production database or provider settings were changed. After explicit user authorization, `a@a.com` was bootstrapped as the initial platform owner in the local development database (audited; no Premium grant).

## Initial owner

Choose an existing, active, registered human account by its exact user ID, then run:

```sh
pnpm --filter server admin:bootstrap <user-id>
```

The command loads the root environment file, creates the first platform owner, increments their version, and writes a `staff.bootstrap` audit record. It refuses if any staff binding already exists. It does not grant Premium. Do not promote by email domain or first-login order. Role-management UI belongs to Settings in the next phase.

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

Platform administration is off by default when NODE_ENV=production. `ADMIN_ENABLED=true` explicitly opens staff-authorized routes. Configure SESSION_SECRET and exact trusted CORS_ORIGIN values first. This flag is an operational gate, not MFA. The app does not yet implement staff MFA: complete an MFA-protected staff access mechanism before enabling public production administration. No deployment was performed.

This change prevents new Live tokens; it does not reach into an already-running LiveKit provider project. Before a production cutover, drain existing Live rooms and invalidate old admission credentials using the actual provider's supported controls. Existing connected sessions can refresh their tokens; do not assume the former ten-minute token lifetime ends those sessions. Only reopen Live after personal budgets/concurrency limits and server-side removal are implemented and tested.

## Validation

- Server integration tests exercise actual stored sessions, platform/workspace scope isolation, CSRF, concurrent confirmations, suspension, grants, expiry, and Live denial.
- Existing workspace/auth tests cover policy compatibility.
- The browser fixture tests staff denial, search/detail, confirmation cancel, grant submission with CSRF, audit display, and desktop/mobile layout using the actual Users component with mocked network responses.
- OpenAPI/SDK drift and server/web/SDK TypeScript checks passed during implementation.

Run focused checks:

```sh
pnpm --filter server exec vitest run src/__tests__/admin.test.ts src/__tests__/adminBilling.test.ts src/__tests__/live.test.ts src/__tests__/workspaces.test.ts src/__tests__/auth.test.ts src/__tests__/stream.test.ts
pnpm --filter web exec node tests/admin.mjs
pnpm sdk:check
pnpm --filter server typecheck
pnpm --filter web typecheck
pnpm --filter @project/sdk typecheck
```
