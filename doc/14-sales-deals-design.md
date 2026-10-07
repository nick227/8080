# 14 · Sales: the Deal model (design, for decision)

**Status:** design only, 2026-10-06. Nothing is built until it is approved. It replaces the Sales sketch in doc/09 §4.2: same intent, smaller first version.

## 1. The distinction

- **A Contact (or Company) is a relationship.** It holds identity, how we know them, and their relationship stage (`leadStatus`: new … customer / lost).
- **A Deal is one specific opportunity to earn revenue.** It has a stage, an owner, an expected value and an expected close.

The same customer can have three deals over two years. Customer lifecycle and sales lifecycle stay separate: closing a deal does not close the relationship, and a lost deal does not make a customer "lost".

| Object | Responsibility |
|---|---|
| Contact / Company (`Contact`, `Account`) | Customer identity, relationship, lead status (exists) |
| **Deal** | The opportunity: stage, owner, value, expected close, outcome |
| **Deal line item** | An inventory item (or a custom line), quantity, **negotiated price, snapshotted** |
| Activity (exists) | History: created, stage changes, won/lost, linked notes and conversations |
| Documents (exists) | Quotes, proposals, agreements attached to the deal |

## 2. The model (first version)

```
Deal              id, workspaceId, number Int (per workspace: D-0001), title(160),
                  accountId?, primaryContactId?          — at least one of the two
                  ownerMemberId?, stage DealStage, currency char(3) (workspace default at
                  creation; fixed once it has lines), valueMinor Int (see below),
                  expectedCloseOn Date?, closedAt?, lostReason(160)?, version Int,
                  createdById?, createdAt, updatedAt, deletedAt?
                  @@unique([workspaceId, number])
                  @@index([workspaceId, stage, expectedCloseOn])
                  @@index([workspaceId, ownerMemberId, stage])
                  @@index([primaryContactId]) @@index([accountId])

DealLineItem      id, workspaceId, dealId, position Int,
                  inventoryId?            — null = a custom line (a one-off service)
                  name(160), sku(80)?     — snapshot of the item when added
                  quantity Int (≥1), unitPriceMinor Int (≥0)   — snapshot, then negotiable
                  createdAt, updatedAt
                  @@index([dealId, position])

DealStageChange   id, workspaceId, dealId, fromStage?, toStage, actorMemberId?, at,
                  actionExecutionId?     @@index([dealId, at])

enum DealStage    qualifying | proposal | negotiation | won | lost
```

- **Status is derived from the stage.** It is open while the stage is qualifying, proposal or negotiation, and won or lost otherwise. There is one default pipeline, defined in code. Custom pipelines come later, as `Pipeline`/`PipelineStage` tables (doc/09 §4.2), once a real need appears.
- **Value:**
  - With line items, `valueMinor` is the sum of quantity × unit price. It is recomputed inside every line-item write transaction (never incremented), the same pattern as room stats.
  - Without line items, `valueMinor` is the expected value a person typed.
  - Exact integers in the deal's currency (A4); no floats anywhere.
- **Line items snapshot their prices.** Adding an inventory item copies its name, SKU and `priceMinor`. Changing the item's price tomorrow never rewrites a deal or quote. The unit price can then be negotiated on the line, and the inventory item is unaffected. Its currency must match the deal's, or adding it is refused.
- **Every change goes through `runAction`** with `expectedVersion` on the deal (409 on conflict), like Inventory. Line-item edits bump the deal's version.
- **History:**
  - `DealStageChange` is the canonical stage history (velocity and conversion later).
  - The timeline gets `deal.created`, `deal.stage_changed`, `deal.won` and `deal.lost` Activities, with subjects deal + contact + account.
  - `ActivitySubject` and `RecordLink` gain a `dealId` column (an exclusive arc), so notes, conversations and messages link to deals the same way they link to contacts.
- **Documents attach to records:** `RecordLink` gains `documentId`. This links a document to a deal, and also to a contact or company.
- **Permissions:** the same verbs as contacts (`record.read` / `record.write`). Non-members get 404.
- **Out of the first version:**
  - custom pipelines
  - probability or weighted forecasts (that would imply sales intelligence we don't have)
  - multiple contacts per deal with roles
  - discounts as separate fields (the negotiated price covers it)
  - tax
  - recurring revenue
  - multi-currency within a workspace

## 3. Lifecycle

```
qualifying ⇄ proposal ⇄ negotiation ──► won   (closedAt set; stage locked unless reopened)
                                   └──► lost  (closedAt, lostReason)
won / lost ──reopen──► the last open stage   (an explicit action, recorded)
```

- **Won**, if the contact (or the company's primary contact) isn't a customer yet, sets their `leadStatus` to `customer` in the same action. It is recorded on the timeline. This is proposed as a deterministic consequence of the person's own action, not an AI inference; see Q5.
- **Lost** never changes the relationship.

## 4. What it unlocks (artifacts, doc/13 §14)

- **"Create a quote for Brightside Dental with 3 headshot sessions and 1 product shoot."**
  - Code resolves the customer (the one matcher; ambiguity → a choice) and the items (inventory by name or SKU; ambiguity → a choice).
  - Code computes the lines, totals and currency, and assigns a quote number. The AI writes at most a short introduction, with no numbers (the A3 contract pattern).
  - The quote is saved in Documents, linked to the deal; the chat links it.
- Spreadsheets from deals, as new `SheetQuery` sources:
  - open deals by stage (count + value)
  - deals expected to close this month
  - won this month (by `closedAt`)
  - line items for a deal
- Contact brief (D3) evidence gains the contact's open deals.

## 5. API (first version)

- `GET /workspaces/{id}/deals` (filters: stage, status, owner, contact, account, expected-close range; keyset pages) and `GET …/deals/counts` (per stage: count and value).
- `POST /workspaces/{id}/deals` · `GET` / `PATCH …/deals/{dealId}` (expectedVersion) · `DELETE` (soft).
- `POST …/deals/{dealId}/stage` `{ stage, expectedVersion, lostReason? }`: move, win, lose, reopen.
- `POST …/deals/{dealId}/lines` · `PATCH` / `DELETE …/lines/{lineId}` (with the deal's expectedVersion).
- `GET …/deals/{dealId}/timeline`.
- `POST …/deals/{dealId}/quote`: creates the quote document.

## 6. Decisions needed before building

1. **Stages.** Qualifying → Proposal → Negotiation → Won / Lost. *Recommended as is.*
2. **Quantity:** whole numbers only, or two decimals (e.g. 1.5 hours of a service)? *Recommended: whole numbers first.* Fractional quantities need a scaled integer (hundredths) to stay exact, which is easy to add later without changing prices.
3. **The quote's form.** It could be a block document or a typed sheet. *Recommended: a block document* (header, customer, lines, totals, terms), with every number written by code from the deal's snapshot. Changing the deal and choosing Refresh data makes a new version; the old quote stays as sent.
4. **Does "Create a quote for X with these items" create the deal?** *Recommended: yes, in Proposal.* A quote without a deal can't be tracked to won or lost. This is a record change, but the person's request states it directly; the chat links both the deal and the quote. The alternative is quotes only from an existing deal.
5. **Won → contact becomes a customer automatically?** *Recommended: yes* (deterministic, recorded, never downgraded on lost).
6. **Tax.** *Recommended: not in the first version.* Quotes say "Prices exclude tax" until tax rules are configured.

## 7. Rollout (after approval)

1. Schema + `DealService` (create, edit, stage, lines, value recompute, history, activity, the won → customer rule) + tests.
2. API + SDK, Deals list and detail in the web (UI owner), and deal links on contacts and companies.
3. Quote artifact (§4), then deal spreadsheets.
