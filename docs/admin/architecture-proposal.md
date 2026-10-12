# 8080 authorization, user Premium, and minimal admin

Status: revised design, 2026-10-11. Incorporates the agreed user-owned Premium and three-screen admin scope. This replaces the earlier workspace billing recommendation. See [implementation status](implementation.md) for the completed Users slice and remaining work. Provider configuration is unchanged.

## Product baseline

Premium belongs to a registered human User and follows that person across every workspace. It does not give workspace membership, elevate a role, or unlock features for teammates. Platform roles and workspace roles use one authorization framework with independent scopes.

Free users can use text chat and foundational workspace work, subject to ordinary resource permissions. They cannot connect to LiveKit, including as viewers/listeners. Premium unlocks Live within explicit personal usage and concurrency limits, full Premium blueprint access, and removal of platform advertising everywhere in the product.

No timers interrupt text chat, tasks, or existing document access. Time budgets apply to expensive capabilities. No Free Live trial, workspace-sponsored Live, shared seat allowance, or automatic metered overage is in this version.

## Free and Premium offer

| Capability | Free | Premium |
| --- | --- | --- |
| Text chat | Available within existing room permissions | Same |
| Tasks and existing documents | Available within workspace/resource permissions, no paywall timer | Same |
| LiveKit join, publish, subscribe, view, or listen | Denied; no token or connection | Allowed where resource permissions permit, within personal limits |
| Blueprint catalog and summaries | Public previews | Public previews plus full protected blueprint content |
| Platform advertising | May appear in designated placements | Suppressed throughout the product for that user |
| Workspace roles and membership | Assigned independently | Assigned independently |

Proposed blueprint boundary: full plans, scenarios, and detailed blueprint content require Premium; catalog metadata and deliberate previews stay public. Future “apply blueprint” actions require both Premium and permission to create the resulting workspace records. Free teammates may read resulting shared tasks/documents if their normal role permits it; they do not inherit access to the protected source blueprint. Downgrading does not remove created work or documents. Existing public content cannot be made retroactively secret.

Recorded uploads and asynchronous media playback use a separate storage pipeline, not LiveKit. Their existing behavior remains until a separate product policy defines storage/processing limits. No additional paid AI, storage, or automation promises are included here.

Advertising is a presentation entitlement for the current viewer, not the workspace owner. Centralize placements in an AdSlot component that suppresses ad requests and rendering for Premium. Hide ads while entitlement state is unresolved to avoid a Premium ad flash; clear state on logout/account switch. User-authored promotional content is not platform advertising. An ad network/integration is separate work; this plan establishes the policy.

## Unified authorization baseline

Use a single typed authorization entry point with scope-specific policies:

```ts
// Proposed interfaces, not existing implementation.
type Scope = { kind: 'platform' } | { kind: 'workspace'; workspaceId: string }

// Permission/scope combinations should be a discriminated union in actual code.
authorize(actor, { scope, permission, resource })
resolveEntitlements(actor.userId, now)
```

`authorize` checks identity, account status, the role binding for the requested scope, membership status where applicable, and resource rules. Premium is an entitlement, never a role. Costly actions then check the entitlement and reserve quota. Backend services enforce these rules for every caller; UI capability flags only control presentation. Unknown permissions and mismatched scopes deny by default.

### Platform scope

Recommended fixed roles:

| Role | Authority |
| --- | --- |
| guest | Existing explicitly permitted guest/public participation; no purchases, Premium, or admin |
| user | Normal registered-user actions and management of their own account/subscription |
| platform_admin | Search/read user status, read membership summaries, suspend/reactivate ordinary accounts, grant/revoke complimentary Premium, read subscription list and open Stripe references |
| platform_owner | Admin authority plus staff role assignment and publishing Premium limit settings |

Guest/user are derived identity classifications. Persist only elevated staff bindings. Bots retain explicit service permissions and are not purchasable Premium users or staff. A platform role does not automatically grant Premium; staff needing Live must have a subscription or an audited grant.

Only platform owners may change staff bindings or suspend/reactivate staff accounts. Admins cannot elevate themselves, disable an owner, or assign roles through profile updates. No self-suspension; protect the last active platform owner under concurrent writes. Bootstrap the first owner through an audited one-time CLI. Role grants must not appear in signup payloads or invite acceptance.

### Workspace scope

Keep existing owner/admin/member roles and active/suspended/removed membership states. Preserve the existing permission matrix and resource rules in `workspacePolicy.ts`, including last-owner safeguards. Owners manage ownership; admins manage allowed workspace operations; members retain existing foundational work permissions. Do not silently broaden or tighten the current role matrix during this refactor.

Platform staff do not become workspace members or gain access to private chat/documents automatically. Reading membership summaries in Users is an explicit platform permission, not a workspace authorization bypass. Workspace roles never authorize `/admin` operations. Current room visibility/member rules continue to apply because rooms are platform-level resources; a workspace listing link does not make a room private to that workspace.

Workspace role/membership mutations remain in existing Team controls for this MVP. The Users detail panel is read-only for workspace membership. If staff intervention is added later, it needs a named platform permission, an explicit command, and the same domain invariants, rather than a fabricated workspace owner identity.

### Evaluation and suspension

Effective ability = active identity + appropriate scoped permission + resource access + required personal entitlement + available quota.

- Global account suspension denies authenticated product activity across all workspaces, including Live. Preserve only narrowly defined account recovery/billing-management access so a user can resolve charges. Suspension does not cancel billing: the admin confirmation must disclose this.
- Workspace suspension/removal denies that workspace's resources without changing global Premium or access elsewhere. A platform room merely linked to a workspace still follows room authorization; do not silently equate the two scopes.
- Canceling or expiring Premium removes premium-only actions; it does not suspend the account or revoke workspace roles.
- Do not authorize with a client-supplied role, workspace membership, Premium flag, or user ID. Resolve the actor from the session and check current bindings server-side.
- Short-lived caches must invalidate on suspension, staff changes, and entitlement changes. Sensitive mutations and Live admission use authoritative current state.

Migrate incrementally: introduce common decision types and platform policy, adapt the existing workspace policy through them, then route callers through the shared entry point. Keep record-level checks and 404 behavior for inaccessible private resources. Add parity tests before replacing existing calls.

## Three admin screens

`/admin` defaults to Users. A simple sidebar contains Users · Billing · Settings. Each page and endpoint has a permission check; hide unavailable tabs. No overview dashboard or analytics navigation.

| Screen | Minimum functionality |
| --- | --- |
| Users | Search by name/email/ID; view account status, effective Free/Premium and source; suspend/reactivate; grant/revoke complimentary Premium |
| Billing | Paginated subscriptions with user, provider/payment status, interval, renewal or end date, sync time, and Stripe record link |
| Settings | Fixed platform staff role management and versioned Premium limits; owner-only writes |

Clicking a user opens a detail panel with workspace memberships/roles/statuses, subscription and grant summary, and recent relevant account/admin activity. This is a bounded account activity summary, not a general audit explorer or private workspace-content feed. Billing fields require the billing permission even inside this panel.

Every admin mutation requires an explicit confirmation naming the target and effect, a reason, server reauthorization, and a durable audit record. Confirmation includes before/after values, effective time, and the fact that access changes do not automatically stop billing. Use version checks to reject stale confirmations. Searches, filters, and opening a Stripe link are reads and need no mutation confirmation.

“Revoke Premium” must identify its source. Revoking a complimentary grant does not cancel paid Premium. A subscriber who still has a paid entitlement remains Premium after grant revocation. Subscription cancellation happens in Stripe or the user's portal in this MVP; emergency full access denial is account suspension. The UI must never report a paid user as Free merely because a local grant was removed.

Skip: dashboard charts, separate workspace management, LiveKit reports, custom roles, advanced billing operations, refund/cancellation tools, and a dedicated audit-log UI. Durable audit storage and internal quota enforcement remain necessary.

## Four backend capabilities

### 1. Centralized platform/workspace authorization

Suggested placement: `apps/server/src/services/authorization/` for actor resolution, typed permissions, platform/workspace policies, and common decisions. Adapt `workspacePolicy.ts` without removing its resource rules. Retain existing room access checks and combine them with entitlement checks for Live.

The existing production cookie uses SameSite=None. Add trusted-Origin validation and CSRF protection for cookie-authenticated mutations; provider webhooks use verified signatures instead. Add staff MFA or an identity provider enforcing it and recent authentication for staff role changes before exposing staff operations publicly. Client confirmation is not a security boundary.

### 2. Personal Premium and cost controls

Resolve Premium from confirmed subscription access OR a valid complimentary grant. The user has one effective plan and one personal usage budget across rooms/workspaces; overlapping grants do not add multiple allowances. Persist starts/ends, source, and plan version. Global suspension overrides product access regardless of Premium.

Proposed settings: `liveEnabled`, `liveMonthlyParticipantSeconds`, `liveMaxSessionSeconds`, `liveMaxConcurrentSessions`, `blueprintsFullAccess`, and `platformAdsDisabled`. Free Live limits are always zero. Settings may change Premium limits but cannot enable Free Live. No workspace seat limit is part of this personal product.

Recommended concurrency default is one active Live connection per user across all rooms/devices. Exact monthly allowance and per-session duration remain to be chosen from cost tolerance. Use UTC calendar-month usage windows for simplicity, equally for monthly and annual subscribers; renewal dates are independent. Resubscription, grant replacement, and workspace switching do not reset the current month's consumption. Explain the reset date in the account UI.

Live admission sequence:

1. Authenticate an active human user and check room access.
2. Resolve personal Premium; return `PREMIUM_REQUIRED` for Free, including viewers. Do not mint a token and do not initialize an automatic LiveKit connection on the client.
3. Atomically check/reserve personal concurrency and usage budget. Reserve bounded time slices, renew while connected, and expire unconsumed reservations. Concurrent token requests cannot reserve the same slot twice.
4. Issue a narrowly scoped token bound to the admission. Verify connected identity against server records and count every participant connection against its own user, including viewers.
5. Warn before session/budget exhaustion and end Live when the allowed duration ends. Text chat and workspace work continue.

Track actual participant time internally with verified LiveKit events, durable session records, and periodic reconciliation of active sessions. Use provider project, room SID, and participant SID to distinguish reconnects. Do not count token requests as consumed minutes. Rebuild usage idempotently; split sessions at month boundaries; mark missing/uncertain events. Provider costs also depend on bandwidth, so these limits are controls, not a promise of exact invoice cost. See [LiveKit events](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) and [billing](https://docs.livekit.io/deploy/admin/billing/).

Revocation, suspension, expiry, and exhaustion require active participant removal, not just denying the next token. Previously issued tokens may still admit/reconnect a client depending on provider behavior; short TTL alone is insufficient. Before launch, validate revocation/rejoin handling against the actual deployment, reconcile unexpected joins, and evict unauthorized participants. Fail closed for new Live admission when entitlement/quota state is unavailable, and document the bounded enforcement delay for active sessions. Existing ten-minute tokens need a rollout drain/revocation strategy. Do not claim zero possible overrun from eventual webhooks.

Blueprints currently ship full data via `apps/web/src/features/blueprints/data` imports in the reader and catalog. Move protected material and scenario generation inputs to server-only storage/modules and expose an entitlement-checked detail endpoint. Retain intentionally public summaries separately. Avoid embedding protected fields in public API responses, frontend bundles, static downloads, preload data, or shared caches. Validate direct URLs and downgrade behavior. UI-only locks are insufficient.

### 3. Stripe synchronization

One billing account per user/provider environment. Checkout and Portal belong under personal `/account` settings, never workspace billing. Customers manage only their own subscription; staff see a permitted summary and Stripe link. Stripe itself controls access to its Dashboard.

Use server-approved monthly/annual Price IDs and hosted Checkout. Verify exact raw webhook bodies, persist events before acknowledgement, deduplicate by provider/environment/event ID, and process with durable leases/retries. Serialize synchronization per account, retrieve current state for reordered events, and reconcile periodically. Browser redirects do not grant access. Stable idempotency keys and a durable purchase attempt prevent duplicate subscriptions under concurrent requests. [Stripe webhook guidance](https://docs.stripe.com/webhooks), [customer portal](https://docs.stripe.com/customer-management).

Keep subscription status distinct from last invoice/payment status. An active subscription scheduled to cancel shows its end date rather than promising renewal. Record sync freshness. Complimentary users may have no Stripe subscription and still appear as Premium in Users.

Proposed lifecycle: activate paid access after confirmed payment; continue until the confirmed access end; cancellation at period end preserves the paid period; incomplete initial payments never grant access. Renewal failure ends paid access at the confirmed paid-through time unless a separately approved recovery grace exists. **Default proposal: no unpaid Live grace**, matching the cost concern. Keep invoice/payment recovery access available. Valid complimentary grants independently preserve Premium. No automatic trial in v1. Refund/dispute events flag an operational review; they do not silently rewrite membership roles. Subscription state handling follows [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks).

Keep this worker in the existing server codebase; a leased database-backed loop can run in the API process initially, with a separate worker entry point when needed. Do not rely on process memory or unawaited work after sending the webhook response.

### 4. Durable admin audit

Store append-only admin events separately from workspace activity: actor, action, target, reason, redacted before/after, confirmation version, request/idempotency ID, timestamp, and outcome. Mutation plus successful audit event commit in one transaction. Record failures/rejections separately without sensitive payloads. Source attribution distinguishes admin, Stripe synchronization, and system expiry. Audit records survive user/workspace deletion under an explicit retention policy.

No audit screen is required. Users detail can read a bounded permitted subset, and operational investigation can use controlled queries until a UI is justified.

## Minimal data additions

| Model | Purpose |
| --- | --- |
| PlatformStaffBinding | user, fixed elevated role, granting actor, timestamps/revocation |
| PremiumPlanVersion | validated feature/limit snapshot and effective policy; immutable once assigned |
| PlanPrice | monthly/annual Stripe Price mapping, environment, amount in minor units, currency, plan version |
| UserBillingAccount | unique user/environment and Stripe Customer mapping; never workspace-owned |
| Subscription | provider ID, account, raw status, price, confirmed access-through, renewal/end/cancel fields, payment summary, sync time |
| PremiumGrant | user, plan version, startsAt/expiresAt, grant/revoke actor and reason |
| ProviderEvent | signed provider event inbox, unique ID, processing state, leases/retry/error data |
| BillingAttempt | durable customer/Checkout creation attempt and stable provider idempotency keys |
| LiveAdmission / LiveParticipantSession | user-owned reservation and connected session facts with provider IDs |
| UserUsagePeriod | per-user monthly quota consumption/reservations; rebuilt/reconciled from sessions |
| AdminAuditEvent | durable privileged action history |

Store usage as integer seconds, money as integer minor units with currency, and provider identity with test/live environment. Preserve financial/audit history when accounts are removed. An invoice history table and cost-report aggregates can wait; Billing needs the subscription and latest payment summary, not a full accounting system.

Settings publishes a new validated limit version with confirmation. Recommended policy: changes apply to new subscriptions/grants; existing assignments retain their version until an explicit, disclosed migration. Show this scope in the confirmation. Do not silently reset consumption, interrupt sessions, or alter Stripe prices by editing plan limits. Complimentary grants require an expiry; grant/revoke does not alter payment state.

## Repository fit and remaining findings

- `apps/server/src/app.ts` and `packages/api-spec/openapi.yaml`: extend current spec-driven routes; isolate raw-body webhook parsing.
- `apps/web/src/app/routes.tsx`: add lazy `/admin` routes and personal billing; retain existing workspace navigation.
- `apps/server/src/services/WorkspaceService.ts`, `workspacePolicy.ts`: reuse membership invariants; add concurrency tests for last-owner changes.
- `apps/server/src/services/live.ts`: currently authorizes by room and mints tokens without paid checks; this is the primary cost gate to change.
- `apps/server/src/plugins/security.ts` denies suspended users, but `__tests__/live.test.ts` substitutes auth and expects suspended viewers. Align this with global denial and test the real security stack.
- `apps/server/src/services/actions.ts`: reuse transaction/idempotency ideas, not workspace actors for platform staff.
- No Stripe integration or durable LiveKit meter was found in the reviewed code. Workspace BudgetItem is unrelated to subscription billing.
- Server startup currently runs `db:push`. Baseline Prisma and introduce reviewed additive migrations before storing billing records.

Suggested APIs: `GET /admin/me`, `GET /admin/users`, `GET /admin/users/:id`, explicit POST suspend/reactivate/grant/revoke commands, `GET /admin/subscriptions`, owner-only staff and limit settings endpoints; `GET /me/entitlements`, `GET /me/billing`, `POST /me/billing/checkout`, `POST /me/billing/portal`; protected blueprint detail and provider webhook endpoints. Update OpenAPI, handlers, and generated SDK together. Use pagination, bounded queries, and consistent denial codes.

## Delivery order and acceptance gates

1. **Authorization + Users:** common policy framework, fixed platform roles, baseline security, audit, search/detail, suspension, and expiring grants. Block Free Live in the same slice. Before granting real Live, require personal quotas and active-session enforcement. Bootstrap staff by CLI while Settings is absent.
2. **Premium delivery:** protected blueprint content and viewer-specific ad suppression; internal Live accounting and cost limits completed before paid launch. Validate Free has no Live connection path, Premium works across workspaces without privilege elevation, and Free teammates remain blocked.
3. **Billing:** personal Checkout/Portal, durable synchronization/reconciliation, minimal Billing list. Verify initial payment, renewals, failures, cancellations, duplicates, reordered events, and restart recovery in Stripe test mode.
4. **Settings:** fixed staff role controls and versioned plan limits when staff administration is needed. Validate stale confirmations, owner protections, scope isolation, and no implicit price/usage resets.

Test real-auth paths as well as policy units: tenant admins denied platform APIs; platform admins denied private workspace content without membership; Premium members denied owner-only actions; global vs workspace suspension; simultaneous admissions across rooms/devices; token replay after revocation; blueprint direct-fetch denial; ads suppressed for Premium in every workspace; one effective entitlement for overlapping paid/granted sources; durable audit on every confirmed admin write. Run focused integration tests, typechecks, and OpenAPI/SDK drift checks for implementation slices.

Remaining product choices: monthly/annual dollar amounts and currency; monthly Live allowance and maximum session duration; exact public blueprint previews; designated advertising placements. Recommended policy defaults are one concurrent Live session, UTC calendar-month limits, no automatic trial, and no unpaid Live grace. These numerical/commercial choices remain proposed, not configured.

Implementation has started with the Users slice; see [implementation status](implementation.md) for verification and rollout details. No Stripe objects were created. Premium Live stays disabled until limits are decided, as explicitly selected by the user.
