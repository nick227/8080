# Contact workbench

Contacts defaults to a table, with the existing grid available. The workspace search bar filters the full contact dataset by name, company, contact-point value, free-text interest, or linked inventory interest. Filters and sorting are URL-backed; column visibility and default sorting are stored per user and workspace in local storage.

## Fields and company settings

The four independent milestone booleans are `contacted`, `qualified`, `proposalSent`, and `won`. They do not change `leadStatus`, imply earlier milestones, or backfill from an existing stage. `nextAction`, `interestedIn`, `lastContactedAt`, `priority`, `waitingOn`, and `potentialValue` support the working queue. Potential value uses the workspace currency and is stored as a decimal amount.

`packages/shared/src/contactFields.ts` defines stable built-in keys and defaults. `ContactFieldDefinition` provides workspace-specific labels, positions, select options, and archive flags. The authenticated `GET /workspaces/{workspaceId}/contacts/fields` merges stored definitions over defaults. The future company settings UI should write these definitions through an owner/admin-authorized, validated endpoint; that editor/write endpoint is intentionally not part of this iteration. Built-in types must remain fixed. Select options have stable values separate from labels.

Custom field values are stored by stable key in `Contact.fieldValues`, validated against the workspace definitions, and patched rather than replaced. Supported types are checkbox, select, number, text, and date. Renaming or archiving definitions preserves values. Existing archived custom values remain readable but cannot be changed. Visible columns are a separate user preference. Custom fields can be enabled through the column picker; server sorting currently covers the built-in workbench columns.

## Outreach and concurrency

Email, call, and text links open the user's apps. Clicking them never records delivery. The existing in-app Composer is a record-only workflow, so the workbench does not present it as actual email delivery.

`PATCH .../contacts/{contactId}` with `logContact: true` atomically sets `contacted` and `lastContactedAt` and records a `contact.contacted` activity. The row supplies an idempotency key and expected version. Checkbox and cell edits use optimistic UI with rollback, retry for ordinary failures, and explicit reload after a version conflict. Stage stays independent.

## Queries and pagination

`contactWorkbench.ts` uses parameterized SQL with allowlisted sort expressions for company/owner projections, pipeline order, booleans, dates, and numeric values. Primary and secondary sorts precede stable name/ID ties. Keyset cursors include the filter/sort signature and all sort values. Unset values sort last, except never-contacted rows sort first for oldest-first last-contacted sorting. Changing filters invalidates the cursor. Due/overdue views exclude won, customer, and lost contacts.

The current schema rollout follows the repository's `pnpm --filter @project/db db:push` workflow; no destructive migration is required.

## Verification

- `pnpm --filter server exec vitest run src/__tests__/contactWorkbench.test.ts src/__tests__/contacts.test.ts`
- `pnpm --filter web test:contacts`
- `pnpm --filter server typecheck`
- `pnpm --filter web typecheck`
- `pnpm sdk:check`
