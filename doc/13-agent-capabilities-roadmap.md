# 13 — The agent: what it does, how it decides, what it needs

**Status:** Plan, recorded 2026-10-06. D0–D3 built and committed (§9–§11). **Direction changed 2026-10-06 (§12): generated artifacts in our own document types come next. Email and follow-up are parked.** Builds on doc/12 (chatbot host, company profile, assistant, voice), doc/09 (Workspace, `runAction`, policy), doc/10 (documents), and the Contacts and Inventory foundations.

Why would a small business use this every day instead of asking a chat model to write things? Because the agent knows the company, the customer, what the business sells and what happened, and it can move the business record forward. Writing documents is one output among several, not the point.

## 1. The defining behaviour

```
understand → extract / summarize → propose → button → deterministic application change
```

Every capability follows it:
- **The model reads and proposes; the application acts.** A proposal is typed data: a contact to create, a status to change, a document to write. The server validates it. It runs only when a person clicks, through the same services and `runAction` a person's click uses (origin `assistant`, the person as actor).
- **Workflow code decides what to read.** The model never queries the database itself and never writes SQL (§4).
- **Numbers come from records, not the model.** Prices, quantities, totals and dates are computed by code. The model writes the words around them (§4.4).
- **A stated fact is never silently replaced** (doc/12 §2). Changes are proposed as a visible diff.
- **The audience follows ownership** (doc/12 §6.5). Workspace-workflow output is workspace-shared, and a person's private material stays private.
- **One voice** for everything written (doc/12 §7.5, `WRITING_RULES`).
- **AI off still works.** Each capability has a deterministic baseline, even if it's only "fill this form".

## 2. Capabilities

| # | Capability | Reads | The AI does | Proposes (buttons) | Changes on click |
|---|---|---|---|---|---|
| 1 | **Fix a fact** / keep the profile current | profile, a person's correction | — (deterministic) | the field diff | profile revision |
| 2 | **More documents from the profile**: About page, short bio, boilerplate, one-pager, FAQ, onboarding, scope summary, agenda | profile, brief | drafts | — (created, linked) | native document |
| 3 | **Messy notes → CRM** ("Talked to Sarah at Acme, needs three cameras, about $10k, call Friday") | the text, the matcher's candidates | extracts | contact/account (matched or new), note, interest, budget, follow-up date, lead status | records + note + timeline |
| 4 | **Before you contact someone: the briefing** | contact, account, timeline, interests, notes | summarizes: who they are, what they want, what was promised, open questions, likely next step | [Follow up] [Draft email] | — (read only) |
| 5 | **Prepare the follow-up** | briefing + profile | drafts from what actually happened | [Edit] [Open in composer] | compose draft (sending stays a click) |
| 6 | **Qualify a lead** | contact facts + history | finds missing qualification facts; asks only those (buttons) | [Mark Qualified] / [Nurture] / … | lead status + note |
| 7 | **Match a need to what we sell** ("under $8k for a 3-person crew") | inventory (filtered by code), the need | ranks 2–3 candidates with reasons | [Attach to lead] | interest |
| 8 | **Proposal / quote draft** | profile + contact need + chosen items | writes the narrative only | [Create proposal] | blocks document + priced line-item sheet (§3) |
| 9 | **Build or improve an inventory item** | rough notes, manufacturer text | extracts fields, writes the description | the structured fields for review | inventory item |
| 10 | **Next sales step** | conversation / timeline | identifies the asks and timings | [Send pricing] [Follow up Nov 1] [Create deal] | task / follow-up date / deal |
| 11 | **Notice a change** ("we don't offer hosting anymore", "budget went to $15k") | channel / notes vs records | detects the contradiction | [Update] [Just this time] | the record |

## 3. Document connectors (output, by surface)

The agent writes into the three native document types. Each surface gets one typed writer: the model never produces surface JSON directly.

- **Blocks** — exists (`DocumentContentService`, doc/10 §15). Used by #2, the narrative of #8, and #4 when saved.
- **Sheets: the first connector to build (parallel track, D9).** Two kinds:
  - **Live views** (first priority among sheet kinds; cheapest, no new persistence) over workspace data, using the existing dataset descriptor (`surface: grid, source: dataset, query`): "leads to follow up this week", "contacts interested in X". The agent only chooses the query. Rows stay live and permissioned. This works today for Contacts; Inventory needs its own dataset descriptor.
  - **Native sheets**: quote line items, comparison tables, a lead list snapshot. These need **server-persisted native grid content**, which doesn't exist yet: native sheets are device-local, and only CSV imports have a server copy. Build it like `DocumentContent`: versioned, a save refused if someone saved first, live, and a typed cell model (`text | number | currency | date`, ≤ N rows). The writer takes `{ columns, rows }` produced **by code** (for example, priced lines from Inventory). The model may only name the sheet or add a note row. The web grid editor must load and save it, which needs coordination with the UI owner.
- **Maps** — device-local today. Server persistence after sheets. Uses: account/stakeholder map, service map, process outline. Lower priority.

## 4. The data harness: querying workspace data to decide and to write realistically

Goal: the agent answers from the business's real records, every claim can be traced to a record, and nothing bypasses permissions.

### 4.1 Phase 1: retrieval chosen by the workflow (start here)
Each workflow loads exactly what it needs through typed reads in the existing services. Examples: the contact's timeline, the account, interests, matcher candidates, inventory filtered by category / price / availability. These run under the person's `authorize` and the visibility rules. No model tool use. This covers #3–#8.

### 4.2 Evidence packs
What the model sees is a compact, clipped **evidence pack**: records with ids, the fields that matter, and recent notes. The model's output references ids (`"evidence": ["contact:…", "note:…"]`). A deterministic **grounding check** rejects or flags output that:
- cites ids not in the pack,
- states a number, price or date that isn't in the pack or computed by code,
- names a customer or person not in the pack.

Flags are logged next to the voice flags (`AssistantCall.result`).

### 4.3 Phase 2: queries the model proposes (later, bounded)
When workflows need open questions ("which leads went quiet after a quote?"), the model may *propose* queries in a **typed query language**, never SQL:
- whitelisted fields and operators per dataset
- sort, limit and simple aggregates

The existing `ContactsQuery` dataset descriptor is the seed; add `InventoryQuery`. The server validates and runs each query under policy, at most ~3 per turn, each one logged. Same caps and timeouts as the assistant. Function-calling becomes allowed here, but only for these read tools.

### 4.4 Realistic documents
- Prices, quantities, subtotals, tax and dates are computed by code from records, and laid out as a sheet or table.
- The model writes the prose around them and must not restate numbers it wasn't given.
- Provenance on every generated document: the run, the evidence ids, profile revision, model, and generator.

### 4.5 Matching (#7)
Deterministic filtering first: budget, availability, category, quantity. Then the model ranks the remaining 2–3 and gives the reason for each. Embedding search comes only if catalogues outgrow this.

## 5. One new primitive: the proposal

#1, #3, #6, #7, #10 and #11 all propose a structured change. Build that once:
- **`AgentProposal`**: `{ kind, payload (typed, validated per kind), evidence, status: pending | applied | dismissed | expired }`. It's rendered as a bot message showing the diff (before → after), with [Apply] [Not now], plus [Edit] where the kind allows it.
- **[Apply]** runs the kind's registered deterministic handler (the same service call a person's edit makes). It's idempotent, re-checks permissions and the record's version at apply time, and refuses stale proposals.
- This is the choice primitive (doc/12 §4) with a typed payload. It is also the "important workspace changes are surfaced" half of the AI policy.

### 5.1 Lifecycle rules
- **Expiry:** a proposal becomes `expired` when the target record's version changes underneath it, or after 14 days, whichever is first. Expired proposals stay visible, greyed, with [Refresh] (re-propose against current data).
- **Unsaved edits:** if the user has unsaved edits on the target record, the diff is shown against their draft. Apply never overwrites a draft silently; it asks to keep the edit, take the proposal, or merge field by field.
- **Undo:** every applied proposal records the prior values. An [Undo] is offered for 10 minutes, and later through the activity log. Undo runs only if the target is still exactly at the version that proposal produced. If someone changed it afterwards, their newer work is never reversed: the old proposal is marked non-undoable, and a new corrective proposal ("Propose putting it back") is offered instead.
- **Ambiguity:** when the matcher finds more than one candidate ("Sarah at Acme"), the proposal presents the candidates as a choice plus "New contact". It never guesses.
- **Persistence:** pending proposals belong to the record, not the panel. They survive Previous/Next, preview close and reload.
- **Budgets:** each workflow has a token and time cap, and shows a layout-preserving placeholder while running. On timeout it falls back to the deterministic baseline.
- **Bulk:** one proposal kind may carry several items (for example qualifying a batch), applied per item, each independently undoable.

## 6. Foundation gaps to close on the way

- ~~**Blocking now:** HEAD's web build is broken (`DeskAgent.tsx`).~~ Fixed in D0 (§9).
- **Money:** `Inventory.price` is a `Float` with no currency. Move to integer minor units plus a currency (the workspace already has `defaultCurrency`) before quotes (#8).
- **Interest** has no quantity, budget or note. Deals don't exist (lead status lives on Contact). Decide whether a Deal is needed before #10 can create one.
- **Tasks** aren't built (#10). Transcripts of voice/video items don't exist (#3 and #11 work on typed text until they do).
- **Native sheet and map content** isn't server-persisted (§3).
- ~~**The channel posts two lines for one completion.**~~ Fixed in D0 (§9).

## 7. Order (revised 2026-10-06, by daily-use value and dependency)

Core track (CRM value first):
0. **D0 Unblock:** fix the web build; dedupe the channel completion message.
1. **D1 Fix a fact + the proposal primitive** (§5, §5.1).
2. **D2 Messy notes → CRM** (#3): extraction, matcher, proposal, apply, undo.
3. **D3 Contact briefing** (#4): retrieval + evidence pack + grounding check, shown in the record UI (§8).
4. **D4 Follow-up draft** (#5) into the existing composer.
5. **D5 Qualification** (#6).
6. **D6 Money fix, then Inventory matching** (#7).
7. **D7 Proposal / quote** (#8): blocks narrative + priced sheet. Needs D6 and D9.
8. **D8 Change detection** (#11) and next sales step (#10). Needs the tasks/deals decision.

Parallel track (independent, can run alongside D1–D4):
9. **D9 Sheet connector** (§3): Inventory dataset view first, then server-persisted native grid content.
10. **D10 More profile documents** (#2): document-type registry on the existing engine.

Old numbering (D2 documents, D3 sheets, D4 notes, …) is superseded by this list.

Maps, query-proposing tools (§4.3), embeddings and transcripts come when a slice needs them, not before.

## 8. Where the agent appears in the UI

Uses the shared navigation: Contacts and Inventory areas, record bar (Back to results, position, Previous/Next), single preview panel, full record.
- **Briefing** sits at the top of a contact's preview and full record, in the same place in both. It's read only, with [Follow up] [Draft email].
- **Proposals** render as inline diff cards on the record they target, and also as a chat message linking to that record. They belong to the record (§5.1).
- **Notes → CRM** starts from a single "Add notes" entry in the contacts area; the result opens the affected record in the preview.
- **Inventory** gets matching (#7) as "Suggest items" on a contact, opening results in the single preview panel, with Back to the contact.
- **Loading** states use placeholders that keep the final layout.
- **Keyboard:** Apply and Dismiss are reachable by Tab, with focus returning to the card after the action.
- **Acceptance:** run the realistic session from the navigation design with a pending proposal on one record; navigating away and back must keep the proposal and the user's place.

## 9. As built

### D0, unblock (2026-10-06)
- **Type-check contract (0c3edd6):**
  - `runAgent` takes the shared `Desk` type, so it can't drift from the desk list.
  - `apps/web/tsconfig.json` extends `tsconfig.app.json`. A bare `tsc --noEmit` used to check nothing (a references-only config); it now checks the app.
  - The web `build` runs `pnpm run typecheck` before `vite build`. `pnpm typecheck` is the check (CI runs it). `vite build` alone never type-checks.
- **Inventory versioning (6ca9101):**
  - `Inventory.version`: updates require `expectedVersion`, applied in one statement (match id + version, bump the version). A mismatch is 409 `INVENTORY_VERSION_CONFLICT`, never an overwrite. The records screens send the version they read.
- **One channel line per completion (6ca9101):**
  - A flow line may carry `onPosted(itemId)`. The company-profile summary records its activity event against its own item (`ActivityEvent.itemId`), so the event posts nothing more.
- **Green suite (655a502):** access-test sample bodies for the bulk, stock and inventory-import operations. 504/504.

### D1, the proposal primitive + Fix a fact (58047ea, 89f7ce4)
58047ea, another agent's commit, picked up most of D1 mid-work. 89f7ce4 added the profile writes and the web card it depends on.
- **Data:** `AgentProposal` holds kind, target, `baseVersion`, `proposedChange`, a frozen diff, evidence, the chat item, creator, expiry, status (pending / applied / dismissed / expired / undone), the decision and who made it, `resultVersion` and `undoData`.
- **Kinds** (`lib/proposal.ts`, `services/proposalKinds.ts`) register when their module loads. Each handler is the only code that can validate, describe, apply, undo and revert its change. First kind: `company-profile.fact` (target = the workspace's profile; version = the profile revision).
- **Lifecycle** (`services/ProposalService.ts`):
  - Expiry is lazy: a target that moved, or 14 days. Writers also call `expireStale`.
  - Apply is claimed once (concurrent clicks apply once) and is idempotent.
  - Undo needs `version == resultVersion`, else 409 `PROPOSAL_UNDO_STALE`.
  - Revert = a corrective proposal against the current record. Refresh = the same change again, against now.
  - Proposing needs the kind's read verb; applying needs its apply verb (owners/admins for the profile).
- **Profile writes:** `CompanyProfileService.setField` / `restoreField` change one field under a revision row lock and return exactly what they replaced, original statuses included.
- **One object everywhere:** each chat `Item.proposal` is the live row. `GET /workspaces/{id}/proposals?targetType&targetId` returns the identical object. Every state change re-journals the chat item.
- **UI:** `ProposalCard` shows before → after, then by state:
  - pending: Apply / Not now (members see "Waiting for an owner or admin")
  - applied: Undo
  - stale undo: "Propose putting it back"
  - expired: Refresh

  Focus returns to the card after an action.
- **Fix a fact** (`bots/flows/profileFix.ts`): [Fix a fact] on the description summary, or typing "fix a fact" in the channel → which fact → the value (buttons where fixed, else a typed line) → a card.
- **Proof:**
  - server `proposals.test.ts` 11/11, suite 504/504
  - browser `e2e/proposals.cjs` (owner + member, desktop + mobile) 20/20 ×2
- **Not yet:** the unsaved-edits merge (§5.1) belongs to the record forms (D2); bulk proposals; per-workflow budgets with placeholders; a record page for the company profile (its cards live in chat).

## 10. D2: messy note → proposed CRM changes (design, 2026-10-06)

One capability: turn an unstructured note ("Met Sarah Lee from Brightside Dental. They want a new website early Q1, budget around $8k. She asked me to call Friday.") into one proposed CRM change.

**Rules (binding for D2):**
1. **The note is kept verbatim** as a Note (its Message text). Extraction never replaces it.
2. **Match before creating.**
   - Contacts: by email via the matcher, else by full name; an account named in the note narrows them.
   - Accounts: by domain via the matcher, else by name.
3. **Ambiguity becomes a choice, never a guess.** Several candidates → a choice message: "Sarah Lee — Brightside Dental" / "Sarah Lee — Brightside Media" / New contact. The proposal is made after the person chooses.
4. **The model returns proposed facts; server code decides the mutation.**
5. **Values a person entered are never silently replaced.** An existing contact's changes are diff rows. Points (email, phone) are only ever added.
6. **One coherent operation:** kind `crm.note`, one card ("Add Sarah Lee to CRM"), not one card per field.
7. **No aggressive inference.**
   - Every extracted value must carry a `quote` that appears verbatim in the note; anything else is dropped (deterministic grounding check).
   - No lead status, qualification, probability or industry from prose: a new contact gets the default status, and an existing contact's status is never touched (D5 owns qualification).
   - Need, timing and budget are kept as the note's facts (`Note.facts`, with their quotes), not as contact fields.
8. **Atomic:** one `crm.note.apply` action in one transaction creates the account (if new) and the contact (if new), links them, applies the field changes, and writes the note with its links and timeline activities. It reuses the services' own helpers (points, display name, domain), so records match what the services would make.
9. **Same lifecycle as D1:**
   - stale check: an existing contact's version; for a new contact, "still no match" is re-checked at Apply
   - permission (`record.write`), idempotency, Undo while the contact is still at the version Apply produced
   - Undo removes what Apply created and restores what it changed. A new account is kept if anything else links to it.
10. **Stated vs read:** each card row shows the note's own words it came from. A normalized value (Friday → a date, "$8k" → 8,000) shows both.

**Edit:** a pending `crm.note` card can be edited before Apply. Editable rows: name, company, title, email, phone, follow-up. The handler re-validates and re-describes, through `PUT /workspaces/{id}/proposals/{proposalId}`.

**Entry points:**
- API: `POST /workspaces/{id}/crm/notes` `{ text }` returns the proposal or the choice.
- Channel: a message that starts with "note:".
- The contacts area's "Add notes" (§8) calls the API. Wiring it is for the UI owner.
- **AI off:** the bot asks "Who is this note about?" and matches the typed name. The result is a note-only proposal: no extracted fields.

**As built (2026-10-06):**
- Reading: `bots/assistant/provider.ts` `readNote` (strict schema, temperature 0) + `grounding.ts` (deterministic; drops are logged as `evidence.dropped`).
- Plan / match / apply / undo: `services/crmNote.ts`. Kind `crm.note`: `services/proposalKinds.ts`. Entry: `bots/flows/noteToCrm.ts` (drafts in WorkflowRun "crm-note"). API: `addCrmNote`, `editProposal`.
- Card: rows carry `key`/`value` (editable) and `quote` (the note's words); additions show only the new value. Cards are [Apply] [Edit] [Not now].
- Proof:
  - server `crmNote.test.ts` 15/15; suite 537/537
  - browser `e2e/crmnote.cjs` AI off 14/14 and real model 18/18 (desktop + mobile, owner + member)
  - proposals 20/20, Slice B 32/32, choices 26/26, live docs 6/6

## 11. D3: contact briefing (built 2026-10-06)

Read-only intelligence: open a contact, press **Brief me**, and a grounded brief appears at the top of the record. No record is changed. The only write is the viewer's cached brief.

- **Evidence pack** (`services/contactBrief.ts` `buildPack`), bounded and built with the viewer's permissions:
  - the contact (fields, status, follow-up, points) and its current companies
  - the latest 12 notes (verbatim, with their D2 facts)
  - 20 timeline entries (rooms already redacted)
  - 15 messages from linked rooms or items the viewer can see
  - up to 3 documents linked to those rooms (document visibility applies)
  - 16k characters in total
  - Each item has an id (`note:…`, `message:…`) and, where it opens, a link.
- **Brief:** `summary`, `need`, `recent`, `commitments`, `openQuestions` (claims, each citing ids), and `nextStep` (a suggestion, with its basis).
  - `briefGrounding.ts` drops any claim that cites nothing in the pack, or states a number, month or weekday not found in what it cites ("$8k" counts as 8,000).
  - The next step obeys the same specifics rule and is shown apart, labelled "a suggestion, not a record".
- **AI off** (`templateBrief`): who they are and their status, needs from note facts, recent notes and activity, gaps (no email / phone / company / budget), and the follow-up date as the next step.
- **Stale:** `ContactBrief` (per contact × member) stores the brief, the evidence it cites and `packHash`. `stale = hash(today's pack) ≠ packHash`, so a note, message, field change or document edit makes it stale. The card says so and offers Refresh.
- **API:** `GET` / `POST /workspaces/{id}/contacts/{contactId}/brief`. SDK: `useContactBrief`, `useGenerateBrief`. Web: `features/records/ContactBrief.tsx` at the top of the contact's overview (preview and full record). Citations are numbered and open their evidence in place; conversation evidence links to its room.
- **Proof:**
  - server `contactBrief.test.ts` 8/8: template, read-only snapshot, stale, permissions (private room), documents and bounds, AI grounding, fallback, per-member
  - suite 547/547
  - browser `e2e/brief.cjs`: AI off 16/16, real model 18/18 (desktop + mobile)
- **Next, as buttons off the brief:** [Draft follow-up] (D4), [Schedule], [Qualify] (D5). The brief stays the read-only primitive they start from.

## 12. Next direction: artifacts from Contacts, Inventory and Sales (2026-10-06)

The user's call: the agent should produce **documents we support** (block documents, spreadsheets, maps) from CRM and inventory data. These should be genuinely useful exported artifacts, not more conversation features. There is no inbound or outbound email yet, so D4 (follow-up draft) and anything mail-shaped is **parked** until real use cases exist. D5 qualification and D8 change detection wait behind this track. D7 (quote) becomes an artifact here (A5).

### 12.1 One pattern for every artifact

```
ask → typed spec (buttons, or the model filling a whitelisted spec) → data by code (queries,
under the viewer's permissions) → figures by code (counts, totals, splits) → words by the model
(only where words are the product; grounded, WRITING_RULES) → a native document → link in the channel
```

- **Numbers never come from the model.** Every table, total and percentage is computed by code from records or from the person's inputs. The model writes prose around them and may *propose* inputs (e.g. a budget split), which the person confirms with buttons.
- **Every artifact records its recipe** in `provenance`: generator, spec, query, as-of time and a hash of the data it read. That is enough to show "the data changed since" (the D3 stale pattern) and to offer **Regenerate from current data** as a new version, never a silent overwrite.
- **Audience** follows the document audience rule: a workspace workflow's artifact is workspace-visible.
- **Weight matches the job:** trivial asks use no model at all, medium asks one or two calls, heavy jobs run in sections in the background with progress.

### 12.2 Three weights (the user's examples)

| Weight | Example | Model | Output |
|---|---|---|---|
| **Trivial** | "Contacts to follow up this week", "leads by stage", "inventory under 5 in stock" as a spreadsheet | None for presets; optional for turning a sentence into a whitelisted query | Live dataset view (refreshes itself) or a snapshot sheet |
| **Medium** | A monthly marketing budget | One call: proposes channels and a split from the profile and offerings; the person confirms totals with buttons | A typed sheet (months × channels, totals by code) + a short block note on the reasoning |
| **Heavy** | A business plan | Sectioned: one grounded call per section, bounded, resumable | A block document with linked sheets (pipeline, inventory value, budget) and an outline map |

Also from CRM context: **a customer document**, a proposal or quote for one contact. It's built from the D3 evidence pack + the company profile + the chosen inventory items: a block narrative plus a priced sheet computed by code.

### 12.3 Foundations this needs

- **F1 Typed, server-stored native sheets.** Versioned content like `DocumentContent` (a save refused if someone saved first; live). Typed cells (`text | number | currency | percent | date`) and an optional computed totals row. Generators write it; the grid editor loads and saves it (coordinate with the UI owner).
- **F2 An Inventory dataset view,** alongside Contacts: `InventoryQuery` with whitelisted fields and filters (name, SKU, category, price, quantity, availability, status; quantity/price ranges; category). Live views and snapshots both use it.
- **F3 Artifact generators:** a small registry: `{ kind, spec schema, gather(viewer), compute(), compose?(model), surface }`, provenance and Regenerate. Presets register as specs.
- **F4 Money:** `Inventory.price` → integer minor units + currency (the workspace has `defaultCurrency`). Needed before budgets, quotes and financial tables.
- **F5 Sales:** decide the Deal model (contact/account, stage, amount, currency, expected close, line items). Until then, "pipeline" means contacts by lead status. Needed for real pipeline sheets and plan financials.
- **F6 Server-stored maps** (versioned nodes/edges), for outline and account maps. Last: the first artifacts don't need them.

### 12.4 Proposed order

1. **A1 Query → spreadsheet.**
   - F2 (Inventory dataset view)
   - "Save as sheet": a snapshot of any Contacts or Inventory view
   - Presets as buttons ("Follow up this week", "Leads by stage", "Low stock")
   - Optional: a sentence → a whitelisted query, which the person sees before it runs

   Trivial and almost all deterministic. It proves the recipe/provenance/Regenerate pattern on the cheapest case.
2. **A2 Typed native sheets (F1)**, so snapshots and generated sheets are editable and numeric.
3. **A3 Monthly marketing budget:** inputs by buttons (total, months, channels), a proposed split from the profile, totals by code, a sheet + a one-page note.
4. **A4 Money (F4) + the Deal decision (F5).**
5. **A5 Customer document:** a proposal/quote for one contact (brief + profile + chosen items → narrative + priced sheet).
6. **A6 Business plan:** sectioned, background, grounded, with linked sheets.
7. **A7 Maps (F6):** plan outline and account map.

Parked: D4 follow-up / email, D5 qualification, D6 matching as a stand-alone feature (it returns inside A5), D8 change detection.

### 12.5 A1 as built (2026-10-06)

- **Query:** `SheetQuery` (`packages/shared/src/sheets.ts`), contacts or inventory.
  - It has whitelisted columns, filters, groupBy, sort and limit.
  - Dates are workspace-local days (`to` inclusive).
  - `validateSheetQuery` (`services/sheetQuery.ts`) refuses unknown fields; it doesn't ignore them.
- **Running:** `runSheetQuery` reads under the caller's record access and returns a `GridTable` of display strings.
  - Counts, totals rows, money (2 dp, currency in the header) and stock value (price × quantity) are all computed by code.
  - More than 5000 rows → `SHEET_TOO_LARGE`.
  - `describeSheetQuery` puts the query in plain words; that is what the person confirms.
- **Presets:** Follow-ups this week (open leads due by Sunday, overdue first), Leads by stage, Gone quiet (30 days), Low or out of stock, Stock by category, Price list. Relative dates resolve when the sheet is made.
- **Document:** a native grid with server-stored rows (`payload`), which the web already shows for everyone with access.
  - `provenance` is the `SheetRecipe`: preset, resolved query, summary, asOf, timezone, currency, rowCount, dataHash, previousId.
  - `protectedDataset` = the source, so reading it needs record access.
  - It's private by default. A sheet made in the channel is workspace-visible (the document audience rule).
- **Stale and Regenerate:**
  - `GET …/documents/{id}/recipe` re-runs the query. `dataChanged` means the hash differs; `periodMoved` means a preset's dates have moved on.
  - `POST …/regenerate` makes a **new** related document with the same audience. The old one is never changed.
- **Channel:**
  - `sheet` → the presets as buttons.
  - `sheet: <request>` → one model call (`planSheet`, strict schema, temperature 0) → validated → "I'd make this sheet: …" with [Make the sheet] [Cancel]. The draft is kept in WorkflowRun `sheet-query`.
  - Unsupported, invalid or empty requests are said plainly, and nothing is made. With AI off, `sheet: …` offers the presets.
- **API:** `listSheetPresets`, `describeSheet`, `createSheet`, `getDocumentRecipe`, `regenerateDocument`.
- **Tests:**
  - server `sheets.test.ts` 10/10; full suite 568/568
  - real model (gpt-4.1-mini): 8/8 sample requests gave valid queries, and "deals closing this month" was refused as unsupported
- **Not yet:**
  - no web control for [Regenerate] or "data changed" on a sheet (for the UI owner: `getDocumentRecipe` / `regenerateDocument`)
  - no "Save as sheet" from the Contacts and Inventory lists (UI owner: `createSheet` with a query)
  - typed cells and editing generated sheets come with A2

## 13. Minimum necessary context (architecture rule, 2026-10-06)

**AI gets language and ambiguity. Code gets identity, state, math and execution.**

**AI chooses only among bounded, product-defined options. Code owns the structure, math, state and side effects** (user, 2026-10-06). The app already knows each artifact's shape. Separate inputs keep separate owners, and the AI is never asked to design the artifact.

- The model never gets raw workspace dumps. It never generates or reasons about our IDs, and never produces SQL, permissions, totals, timestamps, versions or mutation state.
- Each call does one job. Code narrows the candidates before the model sees them, and the model returns small structured output.
- Composition calls get curated evidence packs, never whole records or history.
- Future smart querying works like this: the model plans a bounded query, the server runs it, code reduces the results, and the model sees only the reduced evidence it needs to explain. It is never a large context by default.

**Three call classes and their contracts** (`bots/assistant/budget.ts`). A contract lists the only input fields allowed, a record cap, and input/output token ceilings. The input count includes the system prompt and output schema; the output ceiling is sent as `max_tokens`, and a truncated output is a failure.

| Job | Class | Input fields | Records | In / out tokens |
|---|---|---|---|---|
| `sheet.plan` (A1) | plan | request (≤300 chars), today, weekday, categories | ≤30 categories | 1100 / 300 |
| `note.read` (D2) | extract | note, today, weekday | — | 2000 / 500 |
| `company.extract` | extract | text, known | — | 2000 / 600 |
| `contact.brief` (D3) | compose | contact, today, evidence | ≤20 items | 6000 / 1500 |
| `company.draft` | compose | documentType, profile, answers, brief, revise | ≤12 answers | 5000 / 2000 |

**Enforcement:**
- `contractViolation` checks every call in `calls.ts` before it is made: extra fields, too many records, too large, or anything that looks like one of our IDs (cuid or UUID).
- In production a violation is refused and logged as an AssistantCall with error `contract: …`. Under test it throws, so every workflow test also tests its workflow's contract.
- `aiContract.test.ts` checks the contracts themselves, the worst-case inputs, and the refusal path.

**What changed to meet it:**
- **D3 brief.** The model sees evidence as `E1, E2, …`; citations are mapped back to records in code.
  - Code selects the pack it gets (`selectForModel`): who the person is, then the newest items per kind (notes 6, messages 5, timeline 6, documents 2), at most 20 items and about 3k tokens of text.
  - The full pack remains the stale check and the source for the AI-off brief.
- **A1 planner.**
  - The prompt is about 760 real input tokens (it was about 1,070 estimated before the field lists were de-duplicated).
  - The request is capped at 300 characters and categories at 30.
  - A listing always leads with Name, decided by code.
  - On the real model, 8/8 sample requests are still valid.

### 12.6 A1 browser check and A2 as built (2026-10-06)

**A1 browser check.** It found that a sheet opened from its channel link showed an empty grid: the rows were fetched only when the document was already in the list. Fixed in 026ebd7.

**A2: native sheets are real, shared, editable spreadsheets.**
- **Model** (`packages/shared/src/sheetContent.ts`):
  - Columns are typed text / number / money / date / boolean.
  - Raw values are stored apart from their display: money is integer minor units in the column's currency, dates are YYYY-MM-DD.
  - `total: sum` on number/money columns. Totals are computed (`sheetTotals`), never stored and never written by a model.
  - No formulas, charts, pivots or arbitrary formatting.
- **Server:**
  - `DocumentContent` holds sheets as well as blocks: whole-document versions, save with `expectedVersion` (409 on conflict), checked field by field (`INVALID_CONTENT`).
  - Generated sheets get typed content v1. Their snapshot (`payload`) stays the recipe's baseline, so human edits never read as "data changed", and Regenerate makes a new sheet and never wipes them.
  - CSV imports start as text columns read from their snapshot (version 0).
- **Web:**
  - `liveBlocks.ts` is one live session for blocks and sheets, with a cell-by-cell three-way merge (`sheetModel.rebaseSheet`): different cells both survive; the same cell keeps theirs and says so.
  - Cells are edited as text and stored typed. A value that doesn't fit is refused with the reason, and a retype that doesn't fit is refused.
  - Numbers are right-aligned and formatted. Totals sit in a summary row, and each column header has a type picker and Σ.
  - A generated sheet shows its recipe (what it is made from, as of when) and, when its records changed, **Make it again**.
- **Tests:**
  - server 578/578 (15 sheet cases), on a clean checkout too
  - browser `sheets2.cjs` 20/20 (typed display, totals, refused input, server save, concurrent edits by two people, refused retype, Make it again keeping edits, mobile)
  - block documents `doclive.cjs` 6/6, after pointing it at the Documents list
- **Not in A2:**
  - a "Create spreadsheet" entry in the Documents New menu (the user-facing action instead of the chat shortcut `sheet`; the UI owner is editing that header now)
  - a Sales model (A4)
  - workspace currency on new money columns (uses an existing money column's currency, else USD)

### 12.7 A3 as built: monthly marketing budget (2026-10-06)

Deliberately boring. Each of the four inputs has its own owner:

| Input | Owner | How |
|---|---|---|
| Business type | company profile, else the person's words | profile `purpose`; otherwise typed (≤120 chars). Never decided by AI |
| Monthly budget | the person, parsed by code | typed amount → `parseCell` money → minor units in the workspace currency. AI never sees it |
| Goal | a button | awareness · leads · sales · retention ("Keep customers") · launch |
| Priorities | buttons (multi) | 0–3 of 7 fixed channels: paid search, paid social, email, content and SEO, local and print, events, referrals and partners |

- **Code** (`services/marketingBudget.ts`):
  - a written-down split per goal
  - +10 points per priority, taken proportionally from the others
  - largest-remainder rounding: whole percents summing to 100, and amounts summing exactly to the budget; 0% channels are left out
  - the typed sheet: Channel · Share (%) [Σ] · Per month (money) [Σ] · What it pays for
  - storage, provenance (the inputs and the source of each), private by default; workspace-visible from the channel
- **AI** (`budget.notes`, compose, 600/400 tokens): one short note per channel.
  - It gets the business type, goal label, priority labels and channel names, and **no numbers**.
  - Notes with digits, for unknown channels or duplicates are dropped and replaced with template notes. The AI-off baseline uses the templates.
  - Real model: about 215 tokens in and 136 out, 14/14 notes usable.
- **Entry points:**
  - channel `budget` → business (if the profile has none) → amount → goal → priorities → "I'd make a monthly budget: …" [Make the budget] [Cancel]
  - `POST /workspaces/{id}/budgets`
- `getDocumentRecipe` returns the budget's recipe (`stale: false`, since there are no records to re-run), so the sheet shows what it was made from.
- **Tests:**
  - server `budget.test.ts` 8/8 (the split over every goal × priority mix × amount; the API; the AI seeing no digits; the full channel conversation); full suite 587/587
  - **no new browser run**: the flow uses the existing choice buttons (including multi-select) and the A2 sheet editor
- **Not yet:**
  - typed free text for goal or priorities mapped by AI to the fixed lists (the buttons cover it)
  - several months as columns
  - a short budget note document beside the sheet

## 14. Course correction: ask → create → link (2026-10-06)

The user's call, ahead of any further agent workflows: **the differentiator is quickly producing useful, editable business artifacts from information already available**, not elaborate conversations. Five rules:

1. **No "Fix a fact".** The company profile is edited through ordinary fields (**Edit company profile**: `PATCH /workspaces/{id}/company-profile`, one action, and the values are final). No conversational correction.
2. **Plain, professional language.** "Create document", "Create spreadsheet", "Edit company profile", "Refresh data". No cute labels or conversational theatrics.
3. **No implied financial intelligence.** Until expenses, revenue and transactions are connected, a budget is a **planning template** (a standard split), not an analysis. It never invents spending or claims to know results, and it says so.
4. **Small, complete artifacts.** A company introduction, a customer summary, a price list, a contact list, a monthly budget: each does one recognizable business job without a long interview. No monoliths. The A6 business plan is dropped from the near-term track.
5. **Documents is the permanent home.** Every generated document and spreadsheet is in Documents at once (reopen, edit, organize, export); the chat posts a link.

**Generating ≠ changing records.** Creating an artifact needs no proposal or approval and no confirmation step. Proposals stay only for consequential CRM changes (D2 notes→CRM).

**The flow:**
- "Create a monthly marketing budget for $2,500." → code reads the amount, goal words and channel names → known profile + deterministic template → native sheet in Documents → chat link.
- Only genuinely missing information is asked for, e.g. no amount → "What is the monthly budget, in USD?".

**As built (31c8689, 81873d3):**
- `profileFix` flow removed. The company-profile summary links the document and **Edit company profile** (a plain form panel in the room).
- Request reading is code (`bots/flows/requests.ts`):
  - "Create a spreadsheet of …" (familiar asks match a preset without a model; negations never do) / "sheet: …"
  - "Create a monthly marketing budget for …" / "budget"
- Spreadsheets are created at once (no confirm).
- The budget asks only for a missing amount. No goal given → a general split.
- Recipe bar: **Refresh data**.
- **Browser suite** `e2e/simplify.cjs` 11/11:
  - plain welcome and summary; no Fix a fact
  - the profile form saves its fields
  - one sentence → budget in Documents with computed totals, edited like any sheet
  - a spreadsheet request is created and linked
- Server suite 588/589. The one failure is `record-views.test.ts`, "due vs overdue" around UTC midnight: date-dependent and not from this change.

**Next:**
- **A4: exact inventory prices** (`Inventory.price` Float → integer minor units + currency), on its own.
- **The Sales/Deal model is a separate design decision.** It is not bundled into the pricing migration.

