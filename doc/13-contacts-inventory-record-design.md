# Contacts and Inventory: shared record experience

Status: proposed design and implementation plan, incorporating the user's decision
to support a sales catalog with optional stock tracking per item. October 6, 2026.

## Product decisions

Contacts and Inventory share four large shapes: collection, create/edit sheet,
record detail, and import workspace. Domain content and actions remain distinct.
The shared experience should make it easy to find a record, understand what needs
attention, and update it without unnecessary navigation.

Inventory is what the workspace offers: products, services, and other catalog
entries. Stock tracking is optional for each item. An untracked product is not
automatically a service. For the first slice, use the existing nullable quantity:
null means untracked; zero means tracked and out of stock; a positive integer
means tracked stock. Do not expose a Product/Service selector until an explicit
type is persisted independently from stock tracking.

Keep lifecycle, business stage, availability, and stock separate:

| Concern | Contacts | Inventory |
| --- | --- | --- |
| Lifecycle | Active / archived | Active / archived |
| Business state | Existing lead stages | Offered / paused, using availability |
| Attention | Follow-up due, overdue, unassigned | Out of stock; later low stock |
| Stock | Not applicable | Optional nonnegative whole-number quantity |

Archiving removes a record from the default working collection without changing
its lead stage, availability, or quantity. Zero stock does not silently toggle
availability. Out-of-stock and paused badges can coexist. Low stock requires a
persisted threshold and must exclude untracked items.

## Visual direction

Retain the existing application palette, typography, light/dark themes, and
density system. Consume shared layout, control, surface, and type tokens; do not
introduce feature-specific palettes. See `apps/web/src/styles/README.md`,
`LAYOUT.md`, and `CONTROLS.md`.

The distinguishing shape is a consistent identity band above a broad content
area and a quieter property rail. Large shapes mean clear grouping and useful
media, while collection rows remain efficient to scan. Avoid wrapping every
field or module in another card.

## Collection

```text
Contacts / Inventory                              Import   + Add
Search…                           Filters    Sort    List / Grid
All   [working views]                                  Archived
───────────────────────────────────────────────────────────────
Record rows or image cards
Pagination / load more
```

Contacts defaults to list; Inventory defaults to grid. Both offer both views.
Remember the view per user/workspace/domain. Search, filtering, sorting, and
selected working view should be navigation state so Back restores the collection.
Preserve scroll position when returning from a record.

Initial working views:

- Contacts: All, Follow-up due, Overdue, Unassigned; stage in filters.
- Inventory: All, Offered, Paused, Out of stock; Archived separate.
- Due today includes today's follow-ups; Overdue uses workspace-local calendar
  dates and excludes customer/lost stages, preserving the existing intent.
- Personal saved views can follow once filtering and sorting are reliable.

Rows and cards share media, title, supporting identity, primary business state,
two or three useful values, attention indicator, and overflow actions. Contacts
show company/email and next follow-up. Inventory shows SKU/category, price, and
stock when tracked. Missing images use consistent initials or neutral item icons.
Search results must distinguish similarly named records.

Primary title opens a full record page. Common edits (stage, owner, follow-up,
availability) can be made in place with pending, success, and error feedback.
Controls inside a row must not accidentally open the record.

Selection exposes bulk actions in a stable toolbar position. Clearly distinguish
selected loaded rows from all matching records. Initial bulk scope can be explicit
selected IDs; do not imply cross-page selection without server support.

Filtering, sorting, and counts operate on the full authorized dataset. Existing
loaded-page contact counts must not be presented as collection totals. Search or
filter changes reset pagination; loading, empty collection, no matches, and
request failure have separate states and appropriate next actions.

## Create and edit

Use a shared right-side form sheet: approximately 560px desktop maximum width,
full-screen on small screens. Keep a stable heading and Cancel / Create or Save
changes footer. Reuse existing panel/control tokens and account for safe areas
and the mobile keyboard. Trap focus, support Escape, and return focus to the
opener; protect unsaved input when dismissing.

Quick Create fields:

| Contacts | Inventory |
| --- | --- |
| Name required | Name required |
| Email, phone, company | Price, SKU, category |
| Lead stage, owner | Offered / paused |
| Optional avatar | Optional primary image |
| | Track stock switch, then quantity |

Stock tracking starts off. Enabling it requires a quantity, including an explicit
zero. Disabling existing tracking explains that the current stock count will no
longer be tracked and requires deliberate confirmation inside the edit flow.
Do not treat an empty number field as an implicit stock reset.

Create opens the new record. Full edit groups Identity, Business details, and
Properties. Keep validation next to fields and preserve values on failure.
Contact duplicate candidates are surfaced without silently merging records.
SKU conflicts link to the existing item when authorized and supported.

Price must show currency from an established application source; confirm that
source during implementation rather than assume dollars. Preserve existing price
storage conventions until a separately scoped money-model change is justified.

## Record detail

```text
← Back to results

[Media] Name                                     Business state ▾
        Supporting identity                     Secondary states
        Primary action   Secondary action                     ⋯

Overview       Activity       Related       Files
────────────────────────────────────────────────────────────────
Main content                          Properties
Next action / attention               Domain fields
Description / notes                   Owner, source
Key relationships                     Created, updated
Recent history                        Edit properties
```

Use a flexible main column and a roughly 320px property rail on wide screens.
Collapse to one column when space is insufficient. On mobile, properties appear
in a disclosure below identity; actions wrap without horizontal page overflow.
Use a compact identity image in both domains; Inventory's larger gallery belongs
in Overview. Tabs are exposed only when their functionality is supported.

Contacts Overview shows next follow-up, relevant notes, company relationships,
interested inventory, and recent activity. Inventory Overview shows description,
primary media/gallery, stock summary when tracked, and interested contacts.
The existing contact-interest relationship is the first cross-domain module.

Contacts primary action is Message; Inventory primary action can be Adjust stock
when tracked, otherwise Edit. Add Use in sale only when a real sale workflow can
consume the item. Avoid inert action buttons.

Successful changes appear in history with actor, time, and before/after values.
Inventory stock adjustment uses a focused interaction showing current quantity,
adjustment, resulting quantity, and optional reason. Atomic server-side updates
and conflict handling are prerequisites for safe concurrent adjustments. Initial
direct quantity editing must not be represented as a complete stock ledger.

Activity presentation may be shared, but contact timelines and inventory history
need their own data adapters. Workspace chat publication is a separate decision;
do not broadcast every property edit automatically.

## Import

Use a dedicated wide workspace rather than the form sheet:

Upload → Map fields → Match existing → Review → Import/results

Show source sample values beside mapped destinations, required-field validation,
status mapping, defaults, and explicit stock-tracking semantics. For updates,
distinguish blank/leave unchanged from intentional clearing. Save reusable column
mappings after the basic flow is reliable.

Review separates create, update, skip, ambiguous, and invalid rows. Users choose
whether matched records update or skip; preview changed values. Names alone never
authorize an automatic merge. Contact email/phone matches may be ambiguous;
Inventory SKU matching follows workspace uniqueness. External IDs are usable only
where their source and scope are established.

Execution needs an import job identity, progress, row-level outcomes, and retries
that cannot duplicate completed rows. Provide downloadable errors and counts for
created, updated, skipped, and failed rows. Preserve existing contact import
semantics where appropriate after inspecting its service/tests; a shared UI does
not require replacing domain-specific import engines.

## Component boundaries

```text
RecordCollection      RecordPreview       RecordBulkActions
RecordDetailShell     RecordMasthead      RecordProperties
RecordFormSheet       RecordMedia         RecordStateControl
RecordImportFlow      RecordActivity      RecordRelations
```

Share structure, behavior, and field primitives. Domain adapters supply identity,
fields, state sets, actions, and modules. A small field descriptor can carry label,
type, grouping, display/edit/import eligibility, and formatting. Keep server
validation authoritative. Do not build a universal schema-driven page engine or
custom-field editor as a prerequisite.

## Existing implementation and gaps

- `apps/web/src/features/inbox/ContactsDesk.tsx`: list, inline add, lead-stage and
  follow-up updates, Message, and interest expansion. Stage filtering/counting
  currently operates over loaded pages.
- `apps/web/src/features/inventory/InventoryDesk.tsx`: list, inline add, availability,
  archive/restore, deletion, and quantity display. It currently labels all null
  quantities as Service; change this to untracked semantics.
- `packages/sdk/src/hooks/useContacts.ts`: contact detail, matching/duplicates,
  company relations, and timeline hooks are available.
- `packages/sdk/src/hooks/useInventory.ts`: list/write and interest hooks exist;
  add a detail hook against the existing inventory get capability.
- `apps/server/src/services/InventoryService.ts`: nullable quantity, primary image
  URL, lifecycle, availability, description, price, and SKU already exist.
- Full-dataset attention filters/counts, configurable sorting, bulk operations,
  inventory history/import, upload/gallery support, and reverse interest browsing
  require capability checks and likely API work before exposure in the UI.

## Delivery sequence and review gates

1. Shared collection and detail shells wired to both domains. Add navigable detail
   identity, list/grid switch, and return-to-results behavior. Preserve Message,
   contact interests, availability, and archive/restore workflows.
2. Shared create/edit sheet and common in-place edits. Implement optional stock
   tracking semantics, domain validation, and meaningful mutation feedback.
3. Server-backed working views and counts, sorting, scoped bulk actions, useful
   Overview relationships, and persisted activity. Add stock adjustment integrity
   before presenting an adjustment ledger.
4. Shared import workspace over domain adapters, mapping preview, matching,
   execution progress, and recoverable row errors.
5. Extend physical inventory only when needed: thresholds, locations, scanning,
   and movement history. Gallery and personal saved views can follow independently.

Validate each shipped slice in both domains, desktop and mobile, light and dark,
and supported densities. Check keyboard navigation, focus restoration, mobile
keyboard visibility, loading/error/empty states, and long names/missing imagery.
Behavioral checks should cover pagination-aware filters/counts, create-to-detail,
Back restoration, failed saves retaining input, stock null/zero distinctions,
duplicate/SKU handling, concurrent adjustments, and import retry safety as those
capabilities land. Run the existing relevant test and theme checks; documentation
alone requires no application test run.

## Research basis

Quick qualitative spike, not representative user research. Some reviews are
incentivized; historical complaints identify failure modes rather than prove
current defects. Recommendations above are design inferences.

- [Pipedrive user reviews](https://www.g2.com/products/pipedrive/reviews?page=3&region=canada):
  follow-up prompts, clear relationship momentum, email sync, and discoverability.
- [Attio user reviews](https://www.g2.com/products/attio/reviews): connected context,
  customizable records, and reduced manual work; setup, migration, and bulk-edit
  friction argue for defaults and efficient common actions.
- [Sortly user reviews](https://www.g2.com/products/sortly/reviews): pictures, mobile
  tracking, tags, and scanning; search/performance complaints reinforce fast browse.
- [Sortly App Store reviews](https://apps.apple.com/ca/app/sortly-inventory-simplified/id529353551?platform=iphone&see-all=reviews):
  ease of use; an older missing-folder-context complaint motivates informative results.
- [Pipedrive import matching documentation](https://support.pipedrive.com/en/article/how-to-avoid-duplicates-during-an-import):
  reference for domain-aware identity matching, not evidence of user preference.
