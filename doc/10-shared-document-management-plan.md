# 10 — One document list: blocks, mental maps, grids, and Google links

**Status:** Revised proposal; planning only, no library selection or implementation implied.  
**Date:** 2026-10-05  
**Revision:** Separates live queries, review exports, scheduled reports, and tailored starter documents; keeps deterministic automation distinct from AI generation.

## 1. Product scope

Build a simple workspace **Documents** list. A document can open a native editor, a connected view of business records, or a Google document in a new tab. All entries share identity, ownership, access, room links, and discovery. Native tools share the same collaboration experience.

| Entry | What opens | Who owns the content |
| --- | --- | --- |
| Block document | Our vertical title / paragraph / media editor | Our document service |
| Mental map | Our collaborative shapes-and-connections canvas | Our document service |
| Spreadsheet | Our small business grid | Our document service |
| Connected contacts sheet | The same grid showing real contacts | Canonical contact service; document stores view configuration |
| Google Doc / Google Sheet link | Google in a new browser tab | Google; our app owns the link entry and its metadata |

**V1 priorities:** One useful list, spreadsheet import, live contacts and a bounded history view, small native tools, and consistent collaboration. Advanced document management and campaign publishing should not make this first release a large office suite.

**Flagship POC:** Open “Contacts” as a spreadsheet, change a real contact's name, and see that same committed change in the normal contact screen and the actual mass-mail preview. A second collaborator sees the update and who is working in the sheet. No import/export round trip, duplicate contact database, or automatic email send.

## 2. Grounding in the current repository

This plan reflects the working tree, including the workspace foundation currently being developed; presence in source is not evidence of production deployment.

| Existing foundation | Reuse and boundary |
| --- | --- |
| `User`, `Profile`, guest upgrade, `Room`, `RoomMember` | One user identity. Workspace membership remains distinct from room membership. |
| `Workspace`, `WorkspaceMember`, `Team` in the current Prisma schema | Documents belong to workspaces; conversations link to them. Registered human workspace members are the initial audience. |
| `workspacePolicy.ts` | Central policy entry point. Current permissions are broad workspace roles; document-specific access needs an explicit extension. |
| `actions.ts`, `ActionExecution`, `Activity` | Audit, idempotent commands, business timeline. Reuse for document lifecycle and record mutations. |
| `RoomChange`, `roomChanges.ts`, `handlers/stream.ts` | Transactional journal and reconnect recovery patterns. Room updates currently poll durable changes; this is not an editor synchronization engine. |
| `presence.ts`, `StreamHub.ts`, `PeopleStrip.tsx` | Deduplicated room presence, reconnect grace, familiar participant UI. Presence fan-out is currently process-local. |
| `Message` / `Item`, anchored replies | Existing conversation and placement model. Link discussion to documents without turning each edit into a message. Existing time anchors do not model document positions. |
| OpenAPI → generated SDK → hooks | Add document management and business commands through the established contract. Version any editor streaming protocol separately. |
| `doc/09-workspace-foundation-proposal.md` | Contacts, record links, and additional business domains are planned. The inspected schema contains the backbone, not the proposed Contact domain. |
| `features/work/sections.ts` | Contacts/inbox/sales currently expose placeholder data in this file. A Documents lens should use real SDK-backed data. |

**Integration discovery gap:** No mass-mail/campaign implementation was found in the inspected server and schema. Treat the actual mail system as an integration dependency to locate, not an assumed existing endpoint. Identify its repository/service, contact IDs, source of truth, permissions, recipient selection, suppression rules, and send lifecycle before claiming end-to-end integration. If it owns contacts today, adapt to that ownership first; do not introduce a competing contact database.

## 3. One list and a shared document envelope

The list has title, type/provider badge, owner, and last activity **known to our app**. Start with title search and type filtering. Creation offers Block document, Mental map, Spreadsheet, and Add Google link. Spreadsheet starts from Import file, Blank, or Business data (Contacts first). Each native editor offers a blank start and a populated starter. Contacts view is a source option of the grid experience, not a separate editor. See §4A for shared relationships and the distinction between editing surface and data source.

Clicking a native entry opens its editor. Clicking a Google entry opens its stored URL directly in a new tab with an external-link indicator. A separate row menu manages title, room links, sharing, and deletion. Each entry also has a stable internal reference so rooms and related records can link to it.

Reuse the list in a room Documents panel, filtered by explicit room links. The workspace owns documents; rooms provide discussion and context. Removing a room link or deleting a room does not delete the document. Deleting a document entry never deletes a contact or a Google file.

V1 management: create, rename, search/filter, share with workspace members, link/unlink rooms, and soft delete/restore. Native ordinary documents can be duplicated; connected-view duplication copies configuration, not contacts. Linked-document duplication creates another reference only. Defer folders, tags, favorites, content search, elaborate history UI, approval workflows, and a template marketplace.

### Google links are first-class entries, not imported copies

“Add Google link” takes a URL and a user-entered title. Store `provider`, validated `externalUrl`, optional extracted provider file ID, creator, and timestamps. Initially support ordinary Google Docs and Sheets document URLs; validate HTTPS and the exact allowed host/path formats, and reject script URLs or deceptive lookalike domains. Preserve supported resource-key/access parameters; normalize only what is safe. Treat stored URLs as protected metadata and avoid logging sensitive query strings.

Open with `target="_blank"` and `rel="noopener noreferrer"`. No embedding, Google OAuth, Drive API, content import, thumbnail fetch, or permission synchronization is required for this slice. Do not fetch arbitrary pasted URLs server-side. A provider file ID can help warn about duplicate links within the workspace, without automatically merging entries or their access rules.

Our sharing controls govern visibility of the **link entry**. Google controls access to the **actual file**. Sharing here does not grant Google permission; deleting or restricting the entry here does not revoke access in Google. Explain this once in Add link / sharing UI. Revocation cannot retract a URL already seen.

Do not show invented Google edit times, save states, revision history, or collaborators. We can show our entry's metadata activity and room discussion; Google handles its own editing and collaboration. If access is denied or the file is removed, Google handles that destination state; users can update/remove the stored link here. Automated link-health checks are deferred.

## 4. Shared layers, deliberately small

| Shared layer | Responsibilities | Surface-specific work |
| --- | --- | --- |
| Document registry | List, metadata, type, ownership, sharing, deletion, room links | Native editor or external-link opening behavior |
| Identity and policy | Existing User / WorkspaceMember, centralized authorization | Business field permissions for contacts; independent Google access |
| Native collaboration | Session, roster, status, reconnect, persistence acknowledgements, quiet change indicators | Block text/ordering, cells, or canvas objects |
| Native persistence | Versioned content schema, durable updates/checkpoints, recovery, quotas | Editor-specific structured content |
| Business integration | Canonical IDs, validated commands, audit, conflicts, refresh | Connected contact columns and commands |
| UI shell | Header, people, state, room discussion, shared controls | Block stack, grid, mental-map canvas |

External entries use the registry and policy layers only; they do not allocate a native content stream. A connected contacts sheet uses shared awareness and view configuration, while record values follow canonical business updates.

Keep a small native editor adapter for mounting, content updates, awareness anchors, and capabilities. Prototype before freezing it. Do not force all surfaces to implement exports, native revisions, or the same content shape when those features do not apply.

## 4A. Interconnectivity review: make the documents work together

### Four experiences, with shared properties and different sources

The four experiences are **blocks, mental maps, grids, and external documents**. A connected contacts view is a grid backed by business records, not a fifth editor. Other curated datasets can later expose history and summaries through the same surface (§7A). Google Docs and Sheets are externally edited documents; their provider subtype does not require a new product surface here.

Describe an entry along two independent dimensions, allowing only supported combinations:

| Surface | Source | Shared properties | What remains specific |
| --- | --- | --- | --- |
| Blocks | Native content | ID, title, owner, access, room links, related items, activity | Ordered text/media blocks |
| Mental map | Native content | Same document properties | Positioned shapes/text and connections |
| Grid | Native content **or** authorized business dataset | Same document properties | Rows/columns; source determines edit commands |
| External document | Provider URL | Same entry properties | New-tab destination and provider-owned content/access |

Implement this with a small validated descriptor, not an unrestricted matrix. For example, a contacts query cannot suddenly be attached to a block editor. Capabilities such as `editContent`, `editRecords`, `openExternal`, `attachMedia`, and `showNativePresence` let the shared shell display the correct controls; the server still authorizes every operation. Avoid scattered checks such as “everything except Google can do X.”

**Shared identity does not mean shared storage.** One document registry supports multiple content shapes and sources. Reuse operations and references where their meaning matches; keep merge rules and canonical record commands specific.

### The missing shared primitive: a reference

Add one shared “Link existing…” picker that can find accessible documents and, as domains land, contacts or other supported records. All four document experiences get a compact **Related** area in their shared shell or entry details. A relationship added at either end produces a backlink at the other, filtered by the viewer's access.

This breaks the largest wall without expanding the block vocabulary: a brief can have a related contacts sheet, mental map, and Google contract while its content still contains only title, paragraph, and media blocks. No fourth reference block, rich-text link editor, embed engine, or copied content is necessary.

The same resolver supplies a reference label, type icon, destination, and unavailable state. Renaming a document updates reference labels through resolution instead of rewriting every source. External references open the saved Google URL in a new tab. Record references open the canonical record screen. A link carries no authority to read its target.

Start with document-level relationships and one neutral meaning, “related.” A later reference can carry a stable source/target anchor: block ID, node ID, row ID, or cell IDs. The containing document remains a usable destination when an anchor disappears. Anchored relationships must not leak hidden contact row IDs or data through document-wide events.

Suggested persistence: a small `DocumentRelation` with real source/target document FKs, workspace ID, creator, timestamps, and a unique canonical pair key for an undirected “related” relationship. Backlinks are the reverse query, not a duplicate row. Document-to-contact links use typed domain FKs through the planned RecordLink extension as the domain becomes available. Room links keep their current explicit table. Share a picker/resolver/API presentation across these typed relations; do not replace the business schema with an unvalidated universal `type/id` graph.

Linking requires management/edit rights on the source entry and read access to the target; it grants no target edit rights. The backlink is derived context, not a modification to the target's content. Authorize both endpoints before returning a relationship, including on reverse queries and counts. On revocation, remove previously resolved labels from client caches. Soft deletion makes a reference unavailable without cascading deletion; restoration can reconnect it. Deleting the relationship removes both forward and reverse presentation, never either document.

### Useful connections between every pair

| Pair | Small useful connection | Boundary |
| --- | --- | --- |
| Blocks ↔ mental map | A brief links to its thinking map; a map links back to the written explanation | V1 uses Related; attaching a document reference to a shape is a later small enhancement |
| Blocks ↔ grid | A proposal or campaign brief links to its contacts/planning table | Open the same sheet; no pasted table snapshot pretending to be live |
| Blocks ↔ external | A short native summary accompanies a Google contract or long draft | Summary is authored here; Google content is not automatically read or synchronized |
| Mental map ↔ grid | A map explains the audience, stages, or decisions behind a contacts/planning view | Arrows express ideas, not executable business transitions |
| Mental map ↔ external | A map identifies supporting Google documents | Links use registry IDs, so title/URL changes have one home |
| Grid ↔ external | A planning sheet and supporting Google Sheet/Doc are related | This does not imply cell synchronization or Google-backed contact writeback |

**The mental map can become the visual index for a body of work.** First deliver plain shapes/text and whole-document related links. Later allow a node to point to a document or record using the same reference picker. Its local text remains the user's explanation; the linked target label resolves separately. This provides useful navigation without turning nodes into embedded editors.

### Walls worth removing

1. **List versus room attachments.** A room panel is a filtered view of the same registry. “Add existing document” attaches an existing identity rather than uploading/duplicating content. Room pinning is placement state, not global document state.
2. **Contacts screen versus contacts spreadsheet.** Both issue commands to the same contact service and subscribe to the same committed record changes. Adding another saved view creates another lens, not another set of contacts. Shared view configuration and record updates are separate streams.
3. **Related content versus backlinks.** Store a relationship once and make it navigable from both endpoints. There is no separately maintained “where used” list to drift.
4. **Native versus external context.** Google entries can have related records, room discussion, ownership, and metadata activity here even though their content editing happens elsewhere. Their entry-details surface supplies that context without intercepting the normal new-tab opening action.
5. **Separate people/status implementations.** Reuse the roster, connection state, actor styling, save/error states, and reconnect handling across native surfaces. An external entry can show app metadata activity, but cannot claim someone is currently editing in Google.
6. **Separate record integration per editor.** Implement canonical contact access and commands once. The contacts grid is the initial editing surface; future authorized record detail panels opened from a map or brief can reuse that service. No editor writes directly to CRM tables.
7. **Media tied to the place it first appeared.** Let an authorized document reference an existing asset through the media service, with its own authorized attachment relationship. Do not duplicate bytes by default or inherit access merely because an asset ID is known. Defer cross-context attachment UX until the service enforces these rules.

### Properties that should not be collapsed

- **Owner, author, and assignee:** The document owner manages an entry; an edit has an author; a contact has a business owner. They may be different people. Linking them does not synchronize these roles.
- **Title and content:** Registry title, block title text, shape text, contact display name, and Google file title have different meanings. Only resolved reference labels follow their target's known title automatically.
- **Last activity:** Entry metadata changes, native content edits, and canonical record updates have distinct clocks. Contact edits can refresh a grid without making every saved view look manually edited. Google edit time remains unknown.
- **Document presence and record activity:** People in one sheet are document collaborators. People editing the same contact through another view are record actors. V1 broadcasts committed record changes across views, but does not need a new global “everyone viewing this contact” presence system.
- **Relationship and access:** Related does not mean shared. A room, map, or brief can reference a more restricted document without broadening permissions or showing protected metadata.
- **Link and copy:** A reference stays connected. A copy is independent. Do not introduce automatic block↔node↔row conversions or bidirectional synchronization in V1. Any later “create from selection” action should explicitly copy once and retain a provenance link.

### One interconnected starter, plus independent examples

Offer an optional **Campaign planning set** using the existing starters: a short block brief, a mental map, and an empty structured planning sheet with mutual relationships, all attached to the same room. Users can add their Google Doc/Sheet and connect the planning set to an explicitly bound contacts view. No new project entity is needed: the room supplies discussion/context, and document relationships provide navigation. Creating the set remaps its internal document IDs and relationships together. Ordinary single-document duplication starts without related links; users can explicitly reattach accessible targets, so copying never silently republishes relationships.

The demonstration becomes: read the brief → open its map → open the related contacts sheet → update the real contact → verify the normal contact screen and mass-mail preview → open the related Google document in a new tab. These navigation steps preserve canonical identity; they do not require content replication or automated workflows.

### Keep the synergy work bounded

**V1 additions:** Shared reference picker/resolver, whole-document Related/backlinks, add-existing-document to rooms, source-aware grid capability flags, and a linked starter set. Relationships initially use the existing registry metadata API/cache refresh path; they need no new CRDT engine. Refetch on focus and after commands; add a small authorized invalidation event if live metadata changes require it.

**Next small enhancements:** Shape-to-document references and stable anchor navigation. **Deferred:** Embedded live editors, arbitrary block/row/node conversions, Google content sync, automatic dependency execution, graph-wide permissions, universal custom-record schemas, and transcluded content.

Acceptance must include one relationship between each pair of experiences, rename resolution, correct external opening, reverse navigation, duplicate prevention, target deletion/restoration, and access revocation without backlink/count/title leakage. For contacts, edit through one saved view while another view and the ordinary contact screen are open; all authorized surfaces must show the committed canonical value without sharing private view state.

## 5. Native block document: freeze the scope

Exactly three block types:

- **Title:** Plain large text. At most one title block, initialized for new documents. It can move within the stack. The list's document name is separate metadata, so deleting a title block does not leave the document unnamed.
- **Paragraph:** Plain multiline text. No formatting toolbar in V1; bold, italic, and links can follow a demonstrated need.
- **Media:** One image, video, audio, or file attachment per block, using existing supported media infrastructure with document-aware authorization and lifecycle rules.

Users add, edit, delete, and reorder blocks. Provide drag handles plus keyboard move-up/move-down controls. Upload progress, retry, and missing-media states must preserve the rest of the document. A document-media relationship must keep files alive independently of room message placements; do not assume current Message attachment ownership already handles this.

Proposed content: `Block { id, type, position, text? or mediaId? }`. Use stable block IDs, collaborative text for text fields, and a merge-safe ordering model. Define concurrent move/move and delete/edit semantics; never save the entire stack as a last-write-wins array. If an edited block is deleted remotely, stop editing it and preserve unsynced text for recovery.

Briefs, simple proposals/contracts, email drafts, and creative treatments are examples composed from these same three blocks. Screenplay examples are plain text arranged in paragraphs, not a specialist screenplay editor. HTML is a possible later export, not a raw source-editing surface or a rich-text scope commitment.

**Exclude:** Tables, columns, callouts, embeds, extra block types, page-layout controls, email rendering/publishing, merge-field UI, and professional screenplay pagination. Those are separate future decisions.

## 6. Mental map: shared spatial thinking

The primitive is **shape + text + connection**. Start with rectangle, rounded rectangle, circle, and diamond. Plain text lives inside shapes; a standalone free-text tool can wait.

Users create, drag, resize, delete, and type directly into shapes; connect one shape to another; remove a connection; and optionally add a short connection label or cycle arrow direction. The app chooses sensible routing and line styling. No connector-style picker, layers panel, automatic process execution, or elaborate formatting tools.

Proposed model:

```text
Node { id, shape, x, y, width, height, text }
Edge { id, sourceNodeId, targetNodeId, label?, direction }
```

Node text merges independently of geometry. A move updates position coherently; resize updates coherent geometry. Concurrent drags resolve deterministically, with soft “being moved by…” awareness rather than hard locks in V1. Node deletion wins over stale movement; incident edges disappear, and stale edge creation cannot resurrect a node. Define these invariants in the synchronization spike.

Show collaborators' cursors, selected-shape outlines, and small avatars on shapes being edited. Throttle intermediate drag updates but persist the final position reliably. Pan/zoom is local; remote edits never move another person's viewport. The document editor supports linear thinking, while the mental map supports spatial thinking, using the same people/status language.

## 7. Spreadsheet: a small business grid

The rendering layer and the business-data layer are separate decisions. Evaluate an existing grid renderer through a small spike; do not hand-build virtualization, keyboard navigation, selection, and clipboard behavior unless evaluation shows a concrete reason. No package is selected by this plan, and a grid library does not itself solve collaboration or canonical writeback.

V1 grid interactions:

- Virtualized rendering with stable row/column IDs.
- Click and keyboard cell editing; text, number, and simple typed fields.
- Multi-cell selection, copy/paste, column resize, and headers.
- Add/delete ordinary rows and columns.
- Personal sort/filter; explicit saved shared views can follow later.

**No formulas in V1.** Start with a useful editable table. Formula evaluation, dependency graphs, recalculation, and Excel compatibility would expand the project without proving the contact workflow.

Evaluate license/feature availability, accessibility, React integration, bundle cost, clipboard behavior, controlled cell state, remote updates during editing, and server-backed pagination. Verify row and column virtualization at our actual widths and data sizes. Begin with 5,000 populated cells, then test a 20,000-cell envelope; these are test targets, not a guarantee of smooth rendering or collaboration. Measure scrolling, edit latency, memory, and remote update behavior with realistic data.

Ordinary sheets store cell content. Connected contact views use the same rendering layer, but fixed domain columns and canonical record IDs. Do not expose generic row deletion, arbitrary schema changes, or bulk paste-to-writeback on contacts just because the grid can do them. Initially support copy and single-cell contact edits; add validated bulk Apply later.

## 7A. Business-first direction: spreadsheets as the working interface to business data

**Product hypothesis:** Many teams will arrive with spreadsheets and prefer a familiar grid for both their existing files and the data this platform accumulates. Prioritize and test that hypothesis through actual imports and weekly business tasks. We have not yet established a measured preference or a claim that every Excel workbook will work here.

This changes the grid from an extra editor into a major entry point to the platform. A useful spreadsheet can start with **a file, blank rows, or business data**. All three appear in the same Documents list. Blocks explain the work, maps help plan it, and Google links retain external material; the grid gives people a way to inspect and act on structured business information.

### Follow a real business through its work

Consider a small services business acquiring customers, delivering projects, and following up for repeat work. The following are prospective workflows, not a statement that these domains already exist in the repository.

| Business moment | Documents the team makes | Useful grid and row meaning | Supporting documents |
| --- | --- | --- | --- |
| Moving onto the platform | Customer list, prospect workbook, supplier directory | One imported row per candidate record; reviewed mapping to canonical contacts/accounts | Google links to existing agreements; a short onboarding brief |
| Planning outreach | Audience lists, follow-up lists, campaign planning table | One contact per row; owner, allowed contact fields, last relevant interaction | Campaign brief and audience/message mental map |
| Qualifying opportunities | Lead tracker, pipeline review, sales forecast | One lead/deal per row; stage, value, owner, next action | Proposal, discovery notes, linked customer room |
| Doing the work | Task list, delivery tracker, meeting schedule | One task or event per row; due date, assignee, status | Project brief, meeting notes/media, delivery map |
| Following conversations | Touchpoint log, unanswered-message list | One interaction or thread per row, with defined timestamps and source links | Actual email thread or room conversation |
| Reviewing results | Weekly sales/activity report, campaign outcomes | One event per row or one clearly defined summary group per row | Review narrative and decisions map |
| Managing money/resources | Invoice tracker, expenses, inventory, capacity planning | Imported ordinary tables initially; connected only if those domain systems exist later | Supporting files and provider documents |
| Preparing the next period | Quarterly review, renewal list, historical comparisons | Dated snapshots and rolling live views with explicit periods | Management summary and next-quarter map |

These examples reveal three different user intentions: **maintain records**, **inspect what happened**, and **summarize results**. They can share a grid but must have different editing rules.

### Four data modes in one grid experience

| Mode | Source and row meaning | Editing | Time behavior |
| --- | --- | --- | --- |
| Ordinary sheet | User-entered/imported cells | Users edit document cells | Changes with document edits |
| Live records | Canonical contacts, tasks, deals, etc.; one record per row | Allowlisted fields invoke domain commands | Shows current authorized state |
| History | Domain events/interactions; one occurrence per row | Source facts read-only; corrections go through the owning domain | New events accumulate; original occurrence time is retained |
| Summary | Defined grouped query over records/events; one group per row | Computed results read-only; drill down to source rows | Recalculates for a declared period and freshness boundary |

Contacts remain the first live dataset. Ship one simple read-only business activity/history view after it, so the “accumulated over time” proposition is proven early. Enable only sources backed by implemented, permissioned domains. Summary datasets can follow; no user-authored formulas or arbitrary query builder is needed for the first useful report.

A **snapshot** is a deliberate frozen result of a permitted live/history/summary query, not a fifth editor. Store capture time, source/query version, filters, columns, and completeness/freshness information with protected rows. Snapshots need their own explicit retention and access policy; document sharing alone must not bypass source restrictions. Implement the bounded export/review-copy policy in §7B alongside contacts queries; defer broader archival/as-of snapshots. Exported/downloaded copies cannot be retracted later.

### “Over time” needs history, not just more rows

Current records answer “Which deals are open now?” They cannot alone answer “Which deals were open at the end of June?” Store the domain transitions needed for the latter, or take governed periodic snapshots later. A current-state query with a June date filter is not an as-of report.

For each exposed dataset define:

- **Row grain and identity:** One contact, deal, email, event, or aggregate group; never an undocumented mixture. Stable keys support selection, annotations, and navigation.
- **Time semantics:** Occurred-at versus recorded-at, workspace timezone, fixed period versus rolling window, and how late arrivals/corrections affect results. Label incomplete historical coverage.
- **Meaning:** A “last contacted” field requires an explicit interaction definition. A logged note, received email, and successful outbound send are different facts. Do not infer them from an undifferentiated activity count.
- **Freshness:** Live invalidation, periodic refresh, or externally delayed data. Show “Updated through…” / “Refresh failed” as appropriate; keep last known values distinct from current truth.
- **Metric definition:** For example, unique contacts versus messages sent; deal value versus invoice revenue. Version definitions so a changed calculation is not presented as unchanged historical fact.

Reuse canonical domain models and structured events. Activity is a user-facing timeline, ActionExecution is an audit trail, and RoomChange is a delivery journal; none is automatically a complete reporting ledger. In particular, do not compute business metrics by parsing display-summary JSON or replaying current-state room hydration. Expose an allowlisted business activity dataset, not raw admin audit payloads, to normal workspace members.

Many business facts can be expressed as rows; their full content can remain elsewhere. An email row links to the email, a meeting row to its notes/media, and a room activity row to the conversation. A table of references and selected metadata does not require flattening every recording, contract, or map into spreadsheet cells.

### Import is the first user journey, not an afterthought

Offer **New spreadsheet → Import file / Blank / Business data**. Under Business data, show only available datasets with a short description and live/history/summary label. Google links remain their simple external path; importing a Google-exported file is an independent snapshot, not Google synchronization.

Start with CSV and pasted rectangular data. Treat XLSX as a separate, early compatibility spike because real spreadsheet users may bring multi-sheet/formula-heavy workbooks. The current V1 cannot promise to replace such workbooks. If interviews/import trials show XLSX is essential, prioritize a clearly bounded values-import path before widening the editor. Never silently flatten unsupported workbooks and call that faithful import.

The import flow:

1. Choose file and preview parsing: delimiter, encoding, header row, and selected sheet if the format supports it. Bound file size/rows/cells and use resumable jobs when needed.
2. Suggest column types and let users correct them. Preserve leading-zero IDs, international phone numbers, ambiguous dates, decimal separators, and blank versus zero values; do not silently coerce identifiers into numbers.
3. Explain the result before commit: independent spreadsheet or explicit import into a supported business domain. Ordinary spreadsheet import creates no contacts and sends nothing.
4. Create the native sheet with source filename, import time, parser/mapping version, original row numbers, and validation results. Use stable internal row IDs, and idempotent import completion so retries do not create duplicate documents. Scope/protect original upload and rejected-row retention.
5. If the user chooses “Import as contacts,” delegate to the domain import/matching service with field mapping, create/update preview, ambiguity review, and per-row outcomes. Email remains a matching signal, not a unique ID. Never turn a visual paste into implicit bulk CRM writes.
6. After canonical import, open a live contacts view and preserve provenance back to the import. Explicit reimports use a selected update strategy and stable external identifiers where available; importing the same file must not quietly overwrite later human changes.

Unsupported formulas, macros, styling, merged cells, external links, and attachments must be reported by any future workbook importer. Do not execute workbook code or formulas. Cached formula results, where available, are labeled imported values; missing results are surfaced rather than invented. When CSV export arrives, define escaping for formula-like text so opening a text field in another spreadsheet does not turn it into an executable formula.

### A shared dataset contract, not a new database engine

Introduce a small server-owned dataset catalog as each domain is implemented. Each definition supplies:

```text
Dataset: key, version, description, row grain, stable row key,
         column types/labels, allowed filters/sorts, supported aggregates,
         permission rules, edit commands, time semantics, freshness policy
Saved grid: dataset key/version + selected columns + shared default query
Personal state: current selection, widths, temporary sort/filter, scroll
```

The catalog can begin as typed service definitions. Keep actual contacts/tasks/deals in first-class domain tables. Allow only curated joins/projections; no arbitrary SQL, EAV schema, or universal custom-record engine. Joined/derived columns are read-only unless a precise domain command exists.

Server-side filtering, sorting, pagination, and aggregation operate over the authorized dataset, not only loaded rows. “4,218 matching contacts” must not mean “the 100 currently mounted rows.” Use deterministic ordering with stable tie-breakers. A paged query needs a consistency boundary or an explicit refresh model to avoid missing/duplicating rows during concurrent changes. Bound queries and asynchronous exports; browser virtualization does not remove server query costs.

Selected rows should stay anchored by identity when an edit moves them out of a filter or changes sort order; explain that the row left the view instead of appearing to delete the record. Counts, group labels, history payloads, and drilldowns all enforce row/field permissions. Dataset defaults are shared document configuration, while personal exploration remains local until explicitly saved.

Later, optional sheet-local annotation columns could attach review notes to canonical row IDs. Keep them visibly local to that sheet; do not turn them into shadow CRM fields or pretend they participate in global reports. Defer editable annotations on history/summary rows until stable identity and changing group membership are resolved.

### What this gives the other document types

- A weekly block document explains the decisions behind a linked live report. If it quotes a number, record the observation time; a moving live view must not silently rewrite last week's narrative.
- A mental map organizes campaigns, audiences, and workstreams; its nodes can later open saved grids such as “Customers due for follow-up.” This uses the shared reference layer rather than copying rows onto the canvas.
- A room becomes the place where people discuss a live view and decide what to do. Sharing a saved view communicates its query and canonical source, not another emailed spreadsheet attachment.
- Google links keep existing contracts and complex workbooks accessible. Users can import suitable tables when they want native collaboration and business connections; migration can be gradual.

**Sequence adjustment:** Bring ordinary-sheet import alongside the contacts-grid POC, rather than leaving ordinary sheets until the last editor slice. Then prove one accumulated-history view. Keep the block editor and mental map small; their value increases because they connect to increasingly useful business grids.

**Success measures:** A business can bring a real sample file without unnoticed data corruption, turn a reviewed contact import into canonical records, save a reusable contacts view, observe later authorized system changes without reimporting, and inspect an actual history dataset with honest time/freshness labels. Test the core tasks with real users before assuming formulas, large workbooks, or advanced analytics are unnecessary for their adoption.

## 7B. Query results, exports, and scheduled reports are different products

The user's primary business-data workflow is **choose data → craft a query → inspect the current results → optionally export for review**. A recurring generated report is a separate feature built on that query service. Neither requires an AI agent.

| Object | What is saved | What opening/editing means |
| --- | --- | --- |
| Ad hoc live query | Nothing until the user saves it | Read current authorized source rows; allowed cell edits update canonical records |
| Saved live view | Query definition and layout | Rerun against current data; results can change; no monthly copies |
| Export / review copy | Materialized rows from one query run, with capture provenance | Frozen source values; editing an independent review copy does not write back to contacts |
| Scheduled report | A versioned recipe and schedule, plus separate dated outputs | Each run produces a new report from a defined period; prior outputs do not silently refresh |

Use “Live data,” “Review copy — captured [time],” and “Scheduled report — [period]” badges. The live query may refresh during work; an export has a specific read boundary. Do not describe both as a spreadsheet that happens to save differently.

### The contact query workflow

1. Open Contacts → Spreadsheet, or New spreadsheet → Business data → Contacts.
2. Choose columns and filters with a small visual query builder: field, operator, value, AND conditions, sort, and date range. No query language or arbitrary SQL is needed initially.
3. For “contacts between X and Y,” ask which date field: created, updated, or an available domain-defined interaction timestamp. Default visibly to **Created date**, not an unspecified date.
4. Example: contacts created September 1–30, 2026. Interpret UI dates in workspace timezone and compile to `createdAt >= September 1 00:00` and `< October 1 00:00`. Read their **current** names and other selected values. This does not reconstruct what those contacts looked like in September.
5. Preview results and matching count. Save the query as “September contacts” if useful, edit permitted live fields, or choose **Export CSV** / **Create review copy**. Export all matching authorized rows, not only the loaded page; clearly distinguish an explicit selected-rows export.
6. A review copy opens in our ordinary grid. A CSV download opens elsewhere. Both carry a source query/capture manifest; neither retains automatic contact writeback. Reimporting changes is a separate reviewed domain-import action.

An export must use a consistent database read or a bounded materialization job with a declared capture boundary. Record query/version, columns, timezone/date semantics, capture time, source freshness, row count, and completeness. Failure or truncation must not appear as a complete export. CSV can carry its manifest in the export/job details or a companion file; do not insert metadata lines that break normal CSV parsing.

The creation command requires source export rights and read access at execution/download, not only at button click. Review copies and generated reports preserve source-access requirements in addition to document grants. Start with workspace-readable source datasets; sources with more granular permissions are unavailable for materialization until their read/revocation policy is implemented. Ordinary document sharing cannot expand the audience of a materialized restricted dataset. Downloads are explicit copies that cannot be recalled.

CSV export and a bounded native review copy now belong beside the contacts-query slice, superseding the earlier blanket deferral of snapshots. Historical as-of reconstruction, scheduled archival snapshots, XLSX fidelity, and generalized reporting remain separate work.

### Prefabricated tasks: useful automations with honest labels

A task such as “Every month, prepare my business review” can be a timer plus a query plus a template. Call it a **Scheduled report** or **Automation**. If the product groups it inside an Agents area, show “Scheduled automation — no AI” on the task. Reserve “AI-assisted” for runs that actually use a model, with an explanation of what it generated.

The task has a name, owner, recipe, input dataset/query, calendar schedule/timezone, destination, enabled/paused state, next run, last result, and run history. Run now, pause/resume, and edit future settings are sufficient initial controls. Producing a document does not imply posting a room message, sending email, or initiating a campaign.

Start with a few predefined recipes, enabled only when their source data exists:

| Recipe | Trigger and result | Source requirement |
| --- | --- | --- |
| New contacts this month | Monthly dated contact sheet, total count, source link | Canonical contact creation times |
| Outreach activity review | Monthly facts by channel/status with drilldown or supporting sheet | Defined send/interaction events; no invented delivery or response metrics |
| Open pipeline review | Month-end captured current pipeline with stage totals | Deals/stages; historical movement only if transition history exists |
| Upcoming follow-ups | Weekly review sheet of due actions | Implemented tasks/due dates; no inference from arbitrary room chatter |
| Business review pack | Dated block agenda plus related output sheets | Explicitly selected available recipes; questions remain unanswered until a person responds |

Reports can contain deterministic sentences such as “12 contacts were created in September” and a paragraph asking “Which leads should we prioritize next?” They do not need generated business judgments. No data means “No matching records”; unavailable/incomplete data means “Source unavailable” or “Partial coverage,” never zero by default.

### Minimal scheduler and run contract

Use the same query/materialization service as manual exports. A recipe renders its result into existing grid/block documents and relationships, not a new report editor. Generated source facts are immutable; **Make editable copy** produces an ordinary independent document. Discussion/related decision documents remain editable. A corrected rerun creates an explicit new edition linked to the prior output.

- Compute calendar periods in the configured timezone, with a fixed half-open interval per run. “Monthly” means a calendar boundary, not every 30 days. Save both the reporting period and actual execution/read time.
- Record recipe version, resolved query, permissions/source scope, schedule version, input capture, and output document IDs. Editing a schedule affects future runs and never silently changes past results.
- Use a unique schedule + period + edition key, leases, and retry-safe output creation. Stage output documents and publish the complete set atomically where possible; clean up or resume failed staged work. Retrying the same run cannot produce duplicate report packs.
- Track queued/running/succeeded/failed/skipped, attempts, and errors. Choose an explicit missed-run policy; default to a bounded latest-due catch-up with earlier missed periods shown as skipped, rather than a burst of hidden backlog jobs.
- Recheck the schedule owner's active membership and source rights on each run. Disabled owners/sources pause or fail visibly; there is no silent fallback to broader system privileges. Generated output access remains bounded by source policy.
- Dated period reports over events can be rerun for an old period, with late-arrival semantics recorded. A delayed current-state pipeline capture cannot claim to show month-end state without temporal data; label it “Captured [actual time]” or mark the intended as-of report unsupported.
- Apply row/time/storage/run limits and retention. A notification or room post is a separately enabled action, not a consequence of registering a report destination.

A deterministic scheduler can use audited system execution with the initiating member and constrained scope retained. It needs no model credentials, agent loop, tool planning, or AI budget. AI-written narrative is a later optional stage, never a prerequisite for correct numbers or timely generation.

## 7C. Useful starter documents and chatbot customization

**Production starters are usable work scaffolds, not sample businesses.** Create structure, prompts, and approved template language. Populate business facts only from confirmed user answers or authorized real data. Unknown names, prices, dates, commitments, and metrics stay visibly unfilled. Test fixtures with fictional people belong only in development/tests and never in the onboarding pack.

| Starter | Ready-to-use structure | Real information to fill |
| --- | --- | --- |
| Business overview | Title plus paragraphs for offer, customers, delivery, priorities | Business name, actual services/products, audience, owner goals |
| Client discovery brief | Questions covering problem, desired result, scope, constraints, next step | Real client and answers when available |
| Proposal outline | Objective, scope, deliverables, exclusions, timing, commercial details, next step | Confirmed offer, price, timeline; no fabricated contractual commitments |
| Meeting / weekly review | Agenda, decisions, blockers, follow-ups | Actual meeting context; user-entered outcomes |
| Outreach plan | Audience, proposition, channels, draft message, next action | User-approved audience and message; links to real contact query |
| Contacts workspace | Saved live Contacts query with useful allowed columns; import entry point if empty | Actual contacts; no fabricated rows |
| Work tracker | Empty typed columns for work item, owner, due date, status, notes | Real user-entered work; bind to Tasks only when that domain exists |
| Customer journey map | Generic stages: inquiry, discovery, proposal, delivery, follow-up | User-confirmed stage names and document links; these are template concepts, not claims about completed work |
| Monthly review setup | Business-review agenda plus disabled report recipes | Chosen sources, timezone, reporting period, owner; schedule stays off until enabled |

Offer a small selectable pack—Business overview, Contacts workspace, Weekly review, and Customer journey map—rather than flooding a new workspace. Other starters are available on demand. Blocks still use only title/paragraph/media, maps use shapes/text/connections, and grids use current supported types. A long starter can contain several paragraphs with plain labels; it does not require new formatting primitives.

### A short conversation can produce tailored documents

The onboarding conversation should collect only what materially improves the requested documents, reuse confirmed answers, and allow skipping:

1. What does the business sell, and to whom?
2. How does a customer move from first inquiry to completed work?
3. Who is doing the work, and what are the most important recurring tasks?
4. What is the immediate priority, and what information/files are already available?
5. Which starter documents should be created, and where should they live?

Use a versioned, editable business profile of confirmed answers with provenance, access scope, and confirmation time. This is not a silent summary of every room conversation. Keep private answers out of broadly shared documents unless the user selects that use/audience. Show the profile facts used in the draft so mistakes can be corrected once and future drafts improved.

A deterministic first version can ask template questions and fill approved templates. The later AI-assisted version can tailor wording, propose a work-tracker column set, and adapt map stages using the same confirmed inputs and authorized context. The model returns schema-validated drafts in the existing primitives. Missing facts remain questions; business claims and commitments are not invented.

Show a proposed document pack with editable previews and an explicit **Create documents** action. Creation uses ordinary document services, policy, idempotency, and audit. Keep model-generated text separate from computed report facts; calculations come from the dataset service. Record template version, confirmed-answer references, generation provenance, and source run IDs where applicable. User edits persist independently; profile changes offer regeneration of a new draft rather than overwriting existing documents.

The current chatbot policy in [doc/08 §4.9](08-house-chatbot-requirements.md#49-ai-policy--observational-only-binding-2026-10-04) forbids AI-generated user-visible content and workspace mutations. This plan deliberately proposes a future, bounded document-drafting capability and its permission/action model; implementation must explicitly revise that policy and its enforcement tests for this capability. This planning request is not enabling model calls or silently widening the existing bot runtime. Deterministic templates and scheduled report rendering can proceed through normal authorized application services.

Scope the future AI capability to authorized input → draft preview → user creation. It does not grant autonomous contact edits, send permissions, scheduled model calls, or arbitrary workspace tools. Rate/cost limits, cancellation, schema validation, and failure recovery are required. The product remains usable through templates when AI is unavailable.

### Phasing and proof

1. **First:** Live contact query, CSV export, independent review copy; production-ready empty/structured starters and optional deterministic question flow.
2. **Next:** One predefined scheduled report using the same materialization service, then a small recipe catalog as real domains become available.
3. **Then:** AI-tailored starter drafts after the bounded action/policy design is implemented. Optional AI report commentary is later still.

Validate: live edits change canonical contacts; exported/review-copy edits do not; date filters identify the field and timezone; all matching rows export consistently; schedule retries create one output edition; missing data is never fabricated; changed rights stop subsequent runs/access as defined; generated starter packs contain only confirmed facts, prompts, and template structure; repeated create requests do not duplicate documents; regeneration does not overwrite user edits.

## 8. Contact spreadsheet POC: edit the real record

Expose “Open as spreadsheet” from Contacts and allow “Save this view to Documents.” Both use the same grid and canonical query. A saved document contains field selection/view configuration and a binding, not another contact list. Keep personal sorting/filtering separate from shared view defaults.

Start with a few allowlisted fields: display/name components and job title where supported by the actual domain. Show primary email read-only at first. The foundation proposal derives primary email from ContactPoint, so a future email edit must call that domain operation rather than assign a derived column. Consent, unsubscribe, and suppression remain dedicated business operations.

1. Load authorized contacts with stable IDs and versions, using bounded pagination. Row position and email address are never identity.
2. On committed cell edit, issue a typed command with contact ID, changed field/value, expected version, idempotency key, and source document ID if present.
3. The canonical service validates permissions and data, checks/increments the version atomically, and records the mutation and audit. If this repository owns the domain, use `runAction`; if another system owns it, adapt to that service's equivalent guarantees.
4. Show “Updating contact” until acknowledgement. On success, refresh the ordinary contact screen and all authorized grid views from the committed record. Record changes need durable delivery/recovery, not only a cursor broadcast.
5. A stale-version conflict preserves the user's proposed value and shows the allowed current value for reapply/reload. A failed or offline write never displays “Updated” and must not silently execute on a later reconnect.
6. Verify the actual mass-mail preview uses the new value. If it reads a synchronized projection, expose integration failure/lag and test retry/deduplication. The preview test can avoid sending any email.

Document access never grants record access. Hydrate connected values under each viewer's permissions; do not put restricted contact values into a shared content log, snapshot, thumbnail, or presence payload. Presence can identify an editable cell only to users authorized to see that row. Copy/export, if enabled, obey record policy too.

Deleting a saved view removes the view only. Removing a row from a filter does not delete a contact. Contact deletion/merge is a distinct command; stale views must handle merged/deleted identities explicitly. Undoing a business edit requires a new authorized, version-checked compensating command; document undo does not rewind CRM state.

**POC complete:** Two users view the same contacts, one edits a real record, the other sees the committed value, the normal contact screen agrees, a concurrent overwrite produces a visible conflict, and the actual mail preview resolves the new value. A mock-only preview does not satisfy the integration gate.

## 9. Rooms and consistent native collaboration

A room Documents panel and the workspace list refer to the same document IDs. Opening from two rooms joins one native document session. A viewer in the library is not automatically present in every linked room and must not trigger room-arrival bot behavior.

Workspace/document permissions remain separate from room membership. Public room links do not grant document access. Unauthorized users see an unavailable-document reference without protected title, preview, record content, or participant names. Access to a document does not reveal a private discussion room. Google link entries follow these same registry rules, with Google's independent permission boundary beyond them.

Keep existing room discussion rather than building comments three times. Initial discussion links target the document; stable cell/block/node anchors can follow as a small shared feature, separate from existing audio/video time anchors.

| Signal | Same across native editors | Surface representation |
| --- | --- | --- |
| Online status | Deduplicated avatar/name roster with viewing, editing, idle, reconnecting states | Per-session selection internally; one person in roster |
| Focus | Stable user colors plus names/icons | Block/text location, cell selection, shape/cursor |
| Changes | Brief subtle highlight, grouped by actor | Block margin, cell tint, shape outline |
| Persistence | Saving / Saved / Reconnecting / Unsynced changes | Saved means server durability acknowledgement |
| Record write | Updating contact / Updated / Conflict / Failed | Separate from view configuration save state |

Reuse room presence's connectivity vocabulary and reconnect grace principle; activity is an attribute, not another connectivity state machine. Expire disconnected sessions. Respect reduced motion, keyboard access, and non-color cues. Do not steal focus/scroll on remote changes. Follow-collaborator and detailed catch-up/history UI are later enhancements.

## 10. Synchronization and persistence boundaries

Keep room SSE and its recovery journal for conversations. Native editors need a shared document-scoped collaboration service with a proven merge approach and editor-specific bindings; select it through the spike. Metadata and business commands continue through OpenAPI and generated SDK hooks. Google links need no native editor channel.

Separate durable content updates, lossy awareness, and validated canonical record commands. Do not send every keystroke through RoomChange or business Activity. Attribute accepted updates to authenticated sessions, check permissions on every write, and acknowledge only durable writes. Revalidate outgoing access and propagate revocations. Bound update sizes, rate, client queues, and mounted sessions.

Persist versioned checkpoints plus an ordered/deduplicated update tail with a defined snapshot boundary. Reconnect must recover missing changes, tolerate retries, and never replace live state with an older snapshot. Compact only after a recoverable checkpoint exists. Full offline editing is deferred; transient disconnects show pending state and preserve bounded unsynced work.

Test simultaneous text edits, block moves/deletion, same-cell edits, row deletion versus edits, shape dragging/resizing/text edits, and node/edge deletion. Stable IDs and field-level updates are essential. Native undo targets the local user's operations. Checkpoint recovery is required even though named revision UI is deferred.

Prototype on one process. Before deploying across multiple processes, prove shared presence/fan-out, revocation propagation, durable replay, and per-document ordering/serialization where required. Existing presence is process-local; sticky routing alone does not solve recovery.

## 11. Minimal model and implementation seams

All workspace-owned rows carry workspaceId. Enforce same-workspace business references through the existing integrity approach; room links still require independent room access.

| Model/seam | Purpose |
| --- | --- |
| Document | Common ID, workspace, title, kind, owner, timestamps, soft deletion |
| Native content descriptor | For block/map/sheet entries only: schema version and checkpoint/update head |
| External document descriptor | For Google links only: provider, URL, optional provider file ID; no native content head |
| Business dataset view descriptor | Catalog key/version, query/field configuration and time mode; no copied canonical values; Contacts is the first source |
| Dataset catalog | Typed domain adapters with row identity, permissioned columns, supported queries/commands, and freshness rules |
| Spreadsheet import job | File/provenance, parser configuration, validation and idempotent materialization; domain imports delegate to their own services |
| Query run / materialization | Consistent result capture, source policy, query/version/time manifest, output count/status |
| Report recipe / schedule / run | Versioned deterministic template, constrained execution scope, calendar period, retry-safe dated outputs |
| Confirmed business profile / draft pack | Versioned onboarding answers and provenance; schema-validated proposed documents with explicit creation |
| DocumentRoomLink | Room association without ownership or permission inheritance |
| DocumentRelation | One typed document pair for Related/backlinks; viewer-filtered endpoint resolution |
| DocumentGrant | Small viewer/editor grants for active workspace members; centralized policy |
| DocumentUpdate / Checkpoint | Native content and shared view configuration durability/recovery |
| DocumentMedia | Block attachment references with document-aware access and retention |

Use four surface kinds (`blocks`, `mental_map`, `grid`, `external`) with validated source descriptors: native content, authorized business dataset query, or external provider URL. Permit only the combinations in §4A. Contacts view is a grid source mode. Avoid adding meaningless native-content fields to every external entry. Document ownership is ownership of the workspace entry, not ownership of a Google file or contact.

Start with creator-only entries and explicit workspace-member sharing; owner/admin management follows a documented central policy. External guests and public-link document sharing can wait. Add verbs/targets to workspacePolicy rather than a competing policy implementation.

Document lifecycle and record changes use audited actions. For native content batches, resolve the foundation's “every mutation is an action” contract explicitly: record one action per bounded batch or approve a documented journal-audit exception. Never fill the people-facing timeline with individual keystrokes.

Suggested boundaries: DocumentService and native collaboration/persistence on the server; features/documents list/shell plus editors/blocks, editors/map, and editors/grid on the client; contacts commands remain in their domain service. Templates can begin as versioned seed definitions rather than a new template-management service.

## 12. Starters and delivery sequence

| Entry | Starter | Evidence |
| --- | --- | --- |
| Block document | Project brief with title and useful paragraph prompts; optional user-supplied media | Add/edit/delete/reorder with two people; no invented business facts |
| Block variants | Proposal outline, outreach brief, meeting agenda | Same three types; confirmed inputs and unfilled prompts |
| Mental map | Campaign ideas connected to audience, message, and next steps | Shape/text/connection collaboration |
| Spreadsheet | Empty campaign/work planning table with typed headers | Selection, clipboard, row/column editing and remote changes; no fake records |
| Contacts view | Saved query over actual authorized contacts, with import guidance when empty | Canonical writeback and query/export distinction; test records remain test-only |
| Google link | Add an existing Doc or Sheet with a title | Shared list/room reference and new-tab behavior |

Production starters use real authorized data only through explicit bindings; empty sources stay empty. Fictional datasets remain isolated test fixtures, not onboarding documents. The Google-link starter is an add-link walkthrough; do not invent a working provider file or fabricate its contents.

| Slice | Deliverable | Exit gate |
| --- | --- | --- |
| 0 — Focused spikes | Locate contact/mail ownership; inspect representative customer files including XLSX needs; evaluate grid rendering and native synchronization | Known canonical API and import fidelity limits; representative block/map/grid concurrent operations recover after disconnect |
| 1 — Registry + Google links | Simple list, add-existing room links, Related/backlinks and resolver, shared policy, create/rename/delete/restore, add external link | Doc and Sheet entries open in a new tab; relationships resolve from both ends; access boundaries and deletion semantics pass |
| 2 — Imports + contacts grid POC | Ordinary grid with CSV/paste import; Contacts entry point, saved dataset view, reviewed canonical import, single-cell canonical writes, visual date query, CSV export/review copy | Live edits write back; review-copy edits stay local; real sample import preserves values/types; two-user contacts POC and actual mass-mail preview pass, or external dependency is explicitly blocked |
| 2B — Accumulated history | One allowlisted read-only activity dataset with source links, time filtering, bounded server query and freshness labels | Real events appear without reimport; permissions, row grain, pagination, occurrence/recording times and incomplete coverage are verified |
| 3 — Blocks + native collaboration shell | Three block types, media lifecycle, reorder, shared roster/status/recovery | Starter works with two users; reorder/text conflicts and upload retry pass |
| 4 — Mental map + connected starter set | Shapes/text/connections; link the brief, existing grid/history views, and external entries | All three native types have starters and pass common collaboration checks; the brief/map/grid/Google navigation story works |

The complete V1 includes all entry types, bounded spreadsheet import/query/export, usable starters without mock business data, one permissioned history dataset, and the contact integration proof. Predefined scheduled reports and AI-customized starter drafts are subsequent bounded slices (§7B–7C), not prerequisites for live contact access. Each slice can ship as an honest limited preview. External integration discovery can continue while registry/native work proceeds; it cannot be replaced with a mock to declare the POC complete.

Defer formulas, historical as-of/archival snapshots, arbitrary joins, advanced summaries, named-revision UI, folders/tags, content indexing, advanced exports, custom workflow engines, rich text, Google API synchronization, and email campaign publication. Workbook values import is a separate early prioritization decision based on real customer files; CSV is the initial committed format. A later campaign handoff should freeze document/recipient revisions and respect the sender's suppression and approval rules; it is not a prerequisite for proving contact edits reach the existing preview. Editing documents or contacts never implicitly sends mail.

## 13. Problems, opportunities, and validation

| Problem | Opportunity | Constraint |
| --- | --- | --- |
| Three native editors multiply scope | Common list, shell, session, permissions, recovery | Keep content adapters and product primitives small |
| Google links look like locally managed content | Include existing work immediately | Distinguish entry metadata from provider content, permissions, and presence |
| Spreadsheet UI can consume the project | Reuse a renderer and prove contacts first | No formulas or Excel parity; evaluate rather than assume library features |
| Collaborative reorder/drag is deceptively hard | Few primitives allow focused correctness tests | Test concurrent move/delete and preserve stable identities |
| Grid edits could become a shadow CRM | Direct manipulation of real business records | Canonical commands, versions, permissions, audit, and no copied source of truth |
| Actual mass-mail implementation is not located here | Integration makes the product more useful | Real preview verification is an explicit POC gate |
| Room and document access differ | Reuse conversation context without tying data lifetime to it | Independent authorization and no implicit access grants |

Acceptance covers:

- CSV/paste import preserves identifiers, dates and blanks under the chosen mapping; malformed data is surfaced; retry cannot duplicate a document or canonical import.
- Live/history views distinguish current state from past events, enforce permissions on counts and drilldowns, retain stable row identity across pages, and show refresh failure or limited historical coverage honestly.

- One list containing native documents, a connected contacts view, and Google Doc/Sheet links; correct opening behavior and type labels.
- Related/backlinks across all four experiences resolve current titles and permissions; room attachment reuses document identity; multiple contact views reflect one canonical update while retaining personal view state.
- Link validation, independent Google permission messaging, no fabricated provider status, and deletion of entry without deletion of the external file.
- Two users/tabs across room and library entry points: deduplicated presence, subtle changes, stable focus, and consistent content.
- Block concurrent typing/reordering/deletion; media retention/access/retry; shape movement/text/resize/deletion and edge integrity; grid clipboard and row identity under sorting.
- Reconnect, duplicate delivery, crash after commit/before acknowledgement, checkpoint recovery, and authorization revocation without acknowledged data loss.
- Contact version conflicts, retry idempotency, field permissions, deleted/merged records, actual contact-screen and mail-preview consistency; no false-success state during failure.
- Every native starter with keyboard interaction and reduced motion; list/room usability alongside editing; no protected metadata leakage through references.

Start collaboration load tests with 10 editors, a 100-block document, a 200-node map, and the grid envelopes above. Establish actual limits from measurements. Measure durable acknowledgement and remote visibility separately, plus memory, recovery time, failed business writes, and integration lag. These are validation targets rather than capacity claims.

## Repository references

- [Workspace foundation proposal](09-workspace-foundation-proposal.md)
- [Room change recovery](../docs/room-change-recovery.md)
- [Current schema](../packages/db/prisma/schema.prisma)
- [Workspace policy](../apps/server/src/services/workspacePolicy.ts)
- [Audited actions](../apps/server/src/services/actions.ts)
- [Room stream](../apps/server/src/handlers/stream.ts)
- [Room presence](../apps/server/src/services/presence.ts)
- [Participant UI](../apps/web/src/features/room/PeopleStrip.tsx)
- [Work surface placeholders](../apps/web/src/features/work/sections.ts)

## 14. Backend seam — as built (2026-10-05)

Server, OpenAPI and SDK only; the web Documents UI (commit a65f081) still edits a mocked dataset and can now move to these endpoints. Built in two passes (Codex, then Claude review and completion); everything goes through `workspacePolicy.ts`, `runAction` and the integrity checks of doc/09.

**Registry and contracts** (`DocumentService`, `packages/shared/src/documents.ts`): `Document` with a validated descriptor union — `blocks | mental_map | grid` × native, `grid` × Contacts dataset, `external` × Google Doc/Sheet — and immutable surface/source. Optimistic `version` on every change; idempotent create; soft delete/restore. List is most recently changed first (keyset cursor) with title/surface/room/deleted filters.

**Policy:** `document.create|read|edit|manage`, `dataset.read|export`, `record.import` in the central module. Creator-only by default; viewer/editor `DocumentGrant`s; owners/admins manage. Dataset documents and review copies also require record access — document access never grants record access.

**Relations and rooms:** `DocumentRelation` (one unordered pair, both endpoints filtered for the viewer), `DocumentRoomLink` (needs room visibility; grants nothing, owns nothing).

**Google links:** HTTPS `docs.google.com` document/spreadsheet paths only, resource-key query kept; no fetching. `externalFileId` (from `/d/<id>`) is stored and filterable (`?externalFileId=`) so the UI can warn about a second link to the same file; entries and their access are never merged.

**Dataset contract** (`contactDataset.ts`, `DocumentDatasetService`): a typed Contacts definition (columns, types, writable fields, date/sort fields, freshness `request_snapshot`, limits). Query = columns + filters (`q`, status, owner, `importBatchId`, half-open date range on created/updated) + sort, compiled to a server query with totals. **Keyset pages** on (sort field, id) bound to the query hash — rows added mid-scroll neither repeat nor disappear. Export (≤5,000 rows, consistent read, manifest, formula-safe CSV) and review copies (frozen `GridTable`, no writeback, source protection kept).

**Writeback:** single-row edits of name/title fields through `ContactService.update` with `expectedVersion` (409 `CONTACT_VERSION_CONFLICT`) and an idempotency key (retries return the same result, audited once). `Contact.version` moves on every canonical change.

**Import, through the combined model:**
- *Ordinary sheet import* — `POST /documents/import-csv` → native grid document with provenance; never creates contacts.
- *Import as contacts* — `ContactImportService`, `/contact-imports`: source = pasted CSV **or an imported sheet document**; header-suggested mapping (name parts, title, email, phone, account name, external id + provider); preview through the one matcher → `create | match | review | duplicate | invalid` per row; people decide review rows (create / use existing / skip); commit is idempotent and resumable (100-row chunks under a workspace lock, re-checks "create" rows so a contact added since preview isn't duplicated), never modifies matched contacts, links/creates accounts by exact name, stamps `Contact.importBatchId` + `origin: import`, writes one `import.completed` activity, and can open a live Contacts view filtered to the import. Re-importing the same table reports `previousImportId` and matches instead of duplicating. Row values are pruned after `IMPORT_ROW_RETENTION_DAYS` (default 30; at each new import, and `pruneImports()` for a job); cancelled imports drop them at once.

**Not yet:** native content persistence/collaboration channel (§10), document lifecycle entries on the people-facing timeline, XLSX, lead import (the `ImportBatch` model is generic), scheduled reports, mass-mail integration.

Tests: `documents.test.ts` (13) and `contactImports.test.ts` (9); the spec-driven access guard covers every workspace route (now 78). Server 362/362.

**CI caveat (separate integration issue, not part of this seam):** at the time of this commit HEAD cannot `pnpm install --frozen-lockfile` — `livekit-server-sdk` is in `pnpm-lock.yaml` but not yet in `apps/server/package.json` (the LiveKit work is still uncommitted). This seam was verified in a clean worktree installed without the frozen lockfile; it does not depend on LiveKit.
