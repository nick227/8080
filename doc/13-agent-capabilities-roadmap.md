# 13 — The agent: what it does, how it decides, what it needs

**Status:** Plan, recorded 2026-10-06. Builds on doc/12 (chatbot host, company profile, assistant, voice), doc/09 (Workspace, `runAction`, policy), doc/10 (documents), and the Contacts and Inventory foundations.

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
- **Sheets: first priority.** Two kinds:
  - **Live views** over workspace data, using the existing dataset descriptor (`surface: grid, source: dataset, query`): "leads to follow up this week", "contacts interested in X". The agent only chooses the query. Rows stay live and permissioned. This works today for Contacts; Inventory needs its own dataset descriptor.
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

## 6. Foundation gaps to close on the way

- **Money:** `Inventory.price` is a `Float` with no currency. Move to integer minor units plus a currency (the workspace already has `defaultCurrency`) before quotes (#8).
- **Interest** has no quantity, budget or note. Deals don't exist (lead status lives on Contact). Decide whether a Deal is needed before #10 can create one.
- **Tasks** aren't built (#10). Transcripts of voice/video items don't exist (#3 and #11 work on typed text until they do).
- **Native sheet and map content** isn't server-persisted (§3).
- **The channel posts two lines for one completion** (the workflow summary plus the activity event, 8c61eca). Have the activity event point at the workflow's message instead of posting again.
- **HEAD's web build is broken** (`DeskAgent.tsx` after ae164ce / 8c61eca).

## 7. Order (agreed 2026-10-06)

1. **D1 Fix a fact + the proposal primitive** (§5): the profile's [Update profile] [Just this time], and corrections from chat.
2. **D2 More profile documents** (#2): a document-type registry (template + brief + required facts per type) on the existing engine.
3. **D3 Sheet connector** (§3): server-persisted native grid content and a typed writer; an Inventory dataset view.
4. **D4 Messy notes → CRM** (#3): extraction, the matcher, a proposal, apply.
5. **D5 Contact briefing** (#4): Phase 1 retrieval + evidence pack + grounding check (§4.1–4.2).
6. **D6 Follow-up draft** (#5) into the existing composer.
7. **D7 Qualification** (#6).
8. **D8 Inventory matching** (#7). Needs the money fix (§6).
9. **D9 Proposal / quote** (#8): blocks narrative + priced sheet.
10. **D10 Change detection** (#11) and next sales step (#10). Needs tasks/deals decisions.

Maps, query-proposing tools (§4.3), embeddings and transcripts come when a slice needs them, not before.
