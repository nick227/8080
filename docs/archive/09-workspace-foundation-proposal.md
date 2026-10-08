# 09 — Workspace Foundation: Inbox, Calendar, Contacts, Sales (schema proposal)

**Status:** PROPOSAL rev 3 — architecture approved 2026-10-05; §11 decisions recorded.
**Date:** 2026-10-05

**Rev 3 (2026-10-05):** D3 and slice 4 superseded by [doc/11-inbox-design.md](11-inbox-design.md).
Inbox is an attention queue (`InboxItem`) plus a composer. The §4.5 mailbox sketch is postponed.
**Rev 2 changes:** Tasks are their own model (`Task`), separate from `CalendarEvent`; the
Calendar surface projects both. Email (and account domain) are match signals, not unique
keys. §11 is now a decisions record. Note deletion/sharing rules added.
**Scope:** the data model for a workspace backbone plus four bounded domains. No AI actions
(doc/08 §4.9 stays binding), no UI, no provider sync code.

Field lists below are **sketches** (Prisma-flavoured for readability), not the schema to
be committed. Types, names and indexes are proposed; §11 records the decisions and the small questions left.

---

## 0. What exists today (inspected `packages/db/prisma/schema.prisma`)

| Existing | Reuse? | How |
|---|---|---|
| `User` (guest-first, `kind human\|bot`), `Profile` | **Yes** | Identity stays global. A workspace member *is* a `User`; no second person table for staff. |
| `Room` / `RoomMember` | **Link only** | Conversations stay platform objects with their own visibility. Business records **link to** rooms; rooms never own them (§6). |
| `Message` (reusable content) / `Item` (placement) | **Partly** | `Message` is reused for **Notes** (text/voice/video notes get media, playback and anchors for free). Not reused for email: external senders aren't `User`s. |
| `Media` | **Yes** | Email attachments, import files and note media are `Media` rows, attached through join tables (no new columns on `Media`). |
| `RoomChange` (content-free, sequenced journal) | **Pattern** | Same idea for `Activity`: facts referencing rows, rendered by joining. |
| `BotDecision` / `BotRoute` (replayable logs) | **Pattern** | `ActionExecution` is the general version: every mutation is recorded with actor, input, result. |
| `recountRooms()` (recompute, never increment) | **Pattern** | All derived counters/rollups here are recomputed inside the writing transaction. |
| `apps/web/src/features/work/*` (untracked, in progress) | **Target** | Its `Contact`, `Lead`, `CalendarEvent`, `InboxNote` placeholders become SDK types backed by this model. |

Nothing in the existing schema has to change for slices 0–3. Slice 4 (Inbox) is the
attention queue in doc/11 (`InboxItem`, `Compose`). **All additive.**

---

## 1. Principles (approved 2026-10-05)

1. **First-class models, no EAV.** `Contact`, `Account`, `Lead`, `Deal`, `CalendarEvent`,
   `InboxItem`… are real tables with real columns and FKs. No `Entity/Field/Value`.
   Custom fields/records are a later, separate decision.
2. **Workspace owns business data.** Every domain row carries `workspaceId` (denormalised
   on children too) so every query is workspace-scoped by an index prefix and a policy
   check can never forget it.
3. **Conversations link, never own.** Deleting/leaving a room never deletes a contact,
   deal, thread or event. Visibility of a linked record follows the *record's* workspace
   permissions, not the room's (§6).
4. **Canonical vs derived is explicit** (§3). Derived columns are recomputed in the same
   transaction as the write that changes their inputs (the `recountRooms` rule).
5. **Every mutation is an action.** One `ActionExecution` row per command (audit, idempotency,
   and — later — the seam for agent-proposed actions). Business-meaningful outcomes also
   emit `Activity` rows (timeline). Audit ≠ timeline.
6. **Provenance up front.** Every importable/syncable row has `origin`, `importBatchId`,
   `externalProvider`, `externalId` from day one (§7).
7. **Soft delete + merge**, never hard delete of canonical CRM records. Uniques that must
   ignore deleted rows use the **live-key** pattern (below).
8. **Ownership references `WorkspaceMember`, not `User`.** Member rows are never deleted
   (status `removed`), so history and ownership stay resolvable after someone leaves.

**Live-key pattern** (MySQL has no partial unique index): a nullable column such as
`liveOpenKey` holds a value while the row is in the constrained state and is set to `NULL`
otherwise (soft delete, merge, closed). `@@unique([workspaceId, liveOpenKey])` — MySQL
permits many NULLs. Used only where the invariant is real (one open lead per contact),
**not** for identity guesses like email (§4.1).

**Same-workspace rule:** single-column FKs can't stop a deal in workspace A from pointing
at a stage in workspace B. The repository layer asserts `workspaceId` equality on every
cross-reference, and an invariant test scans all FK pairs. (Composite FKs on
`(workspaceId, id)` are possible in Prisma but fight its relation rules for optional
fields — see D13.)

---

## 2. Entity map

```
                         ┌──────────── Workspace ─────────────┐
                         │                                    │
     WorkspaceMember ── User (existing)      Team ── TeamMember
            │  (owner/assignee everywhere)
            │
 ─ Contacts ─────────────  ─ Sales ──────────────────────  ─ Tasks / Calendar ───────
 Contact ── ContactPoint    Pipeline ── PipelineStage        Task (── parent Task)
   │  \                     Lead ──(converts)──► Deal        CalendarEvent
   │   ContactAccount       Deal ── DealContact                └─ CalendarAttendee
   │  /                     DealStageChange                  Reminder (task | event)
 Account                                                     ─ Inbox (doc/11) ─────────
 Tag ── ContactTag/AccountTag/DealTag                         InboxItem (one member, one source)
                                                              Compose (follow-up, email first)
                                                              Mailbox / thread: postponed (§4.5)
 ─ Shared infrastructure ──────────────────────────────────────────────────────────────
 Note ─► Message (existing)          RecordLink  (subject ⇄ thread/event/note/room/item)
 Activity ── ActivitySubject         ActionExecution          ImportBatch ── ImportRow
```

"**Subject**" = one of the four CRM records a thing can be *about*: `Contact`, `Account`,
`Lead`, `Deal`. Subjects are referenced with an **exclusive arc** — four nullable FK
columns, exactly one set — so links keep real FKs without a polymorphic `type/id` pair.
Adding a subject type later (e.g. `Project`) = one column per arc table.

---

## 3. Shared backbone

### Workspace
```
Workspace        id, name(120), slug(60) @unique, timezone(64) = "UTC",
                 defaultCurrency char(3) = "USD", createdById → User,
                 createdAt, updatedAt, deletedAt?
```

### WorkspaceMember
```
WorkspaceMember  id, workspaceId, userId → User,
                 role   WorkspaceRole  (owner | admin | member)
                 status MemberStatus   (invited | active | suspended | removed)
                 title(120)?, timezone(64)?, invitedById?, joinedAt?, removedAt?
                 @@unique([workspaceId, userId])  @@index([userId, status])
WorkspaceInvite  id, workspaceId, email(255), role, tokenHash(64) @unique,
                 invitedById, expiresAt, acceptedAt?, revokedAt?
                 @@index([workspaceId, email])
```
- Membership requires a **registered** `User` (`isGuest=false`); a guest is asked to
  upgrade first (D8). Bot users are **not** members (D11).
- Last active `owner` can't be removed/demoted (service rule).

### Team
```
Team             id, workspaceId, name(80), description?, archivedAt?
                 @@unique([workspaceId, name])
TeamMember       id, teamId, workspaceId, memberId → WorkspaceMember,
                 role TeamRole (lead | member)
                 @@unique([teamId, memberId])  @@index([memberId])
```
Teams are routing/visibility groups (a deal or thread can belong to a team queue), not
org charts.

### ActionExecution — audit + idempotency + future agent seam
```
ActionExecution  id, workspaceId,
                 action(64)         "deal.move_stage", "contact.merge", "inbox.send" …
                 actorKind          (member | system | integration)   ← `agent` reserved, not enabled
                 actorMemberId?, actorUserId?   (userId kept even after member removal)
                 origin             (ui | api | import | sync | system)
                 idempotencyKey(120)?  @@unique([workspaceId, idempotencyKey])
                 status ActionStatus (pending | succeeded | failed | rejected)
                 targetType(32)?, targetId(32)?   ← plain strings: audit outlives rows
                 input Json, changes Json?  (field diffs: {field:[before,after]}),
                 result Json?, errorCode(60)?
                 parentId? → ActionExecution   (e.g. per-row work under an import)
                 requestedAt, finishedAt?
                 @@index([workspaceId, requestedAt])  @@index([workspaceId, targetType, targetId, requestedAt])
```
- Written in the **same transaction** as the mutation (status `succeeded`), or alone with
  `failed/rejected`. Long-running actions (send email, import) go `pending → …`.
- `actorKind: agent` and statuses `proposed/approved` are **reserved in the design, not
  in the enum** until the agent action model + permission system exist (doc/08 §4.9).

### Activity — the user-facing timeline
```
Activity         id, workspaceId,
                 type(48)           "email.received", "deal.stage_changed", "note.added",
                                    "event.completed", "lead.converted", "owner.changed",
                                    "contact.created", "import.completed" …
                 occurredAt         (when it happened: email date, meeting end)
                 recordedAt         (when we stored it)
                 actorMemberId?, actionExecutionId?
                 -- what it refers to (exclusive arc, at most one):
                 threadId? (denormalised with inboxMessageId, Q-B)
                 inboxMessageId?, taskId?, eventId?, noteId?, dealStageChangeId?, roomId?, itemId?
                 summary Json       (small display snapshot, never read by logic)
                 @@index([workspaceId, occurredAt])
ActivitySubject  id, activityId, workspaceId,
                 contactId? | accountId? | leadId? | dealId?   (exactly one)
                 occurredAt  (copied → timeline index without a join)
                 @@index([contactId, occurredAt]) @@index([accountId, occurredAt])
                 @@index([leadId, occurredAt])    @@index([dealId, occurredAt])
                 @@unique([activityId, subjectKey])   subjectKey = "deal:<id>"
```
One email to a contact at an account about a deal = **one** `Activity`, **three**
`ActivitySubject` rows. Activity is append-only; if a link is removed, the activity stays
(history) but gets a `link.removed` activity of its own.

**Audit vs activity:** `ActionExecution` = everything, field-level, for admins/debugging.
`Activity` = curated business events for people. Some actions write no activity (renaming
a tag); some activity has no action (an inbound email from sync has an `integration`
execution, but a received calendar RSVP may not merit one — Q-C).

### RecordLink — attaching things to subjects (and to conversations)
```
RecordLink       id, workspaceId,
                 -- subject (exactly one):  contactId? | accountId? | leadId? | dealId?
                 -- object  (exactly one):  threadId? | taskId? | eventId? | noteId? | roomId?
                 itemId?            (only with roomId: a specific moment/message in the room)
                 pairKey(80)        "deal:<id>|thread:<id>"   @@unique([workspaceId, pairKey])
                 how  LinkOrigin    (manual | auto_match | import | system)
                 linkedById?, createdAt
                 @@index([threadId]) @@index([eventId]) @@index([roomId]) …per arc column
```
Fixed-cardinality relationships use direct FKs instead (`Deal.accountId`,
`Lead.contactId`, `ContactAccount`); `RecordLink` is only for many-to-many "related to".
Exactly-one checks are enforced in the repository and, optionally, a raw `CHECK` added in
the migration SQL (MySQL ≥ 8.0.16 enforces it).

### Note — reuses `Message`
```
Note             id, workspaceId, messageId → Message @unique, authorMemberId,
                 pinnedAt?, createdAt, deletedAt?
```
The body lives in `Message` (+ `Media`), so a voice/video note records and plays like any
item. Notes attach to subjects via `RecordLink`. A note's `Message` has no `Item`
placement until its author shares it into a room through the existing
`shareMessageToRooms` (author-only; it already works for a Message with no placements).
Sharing is a deliberate publish: the placement then follows the room's visibility, and an
Activity `note.shared` records it. Deleting a note soft-deletes the `Note` only; room
placements are separate publications the author tombstones separately (same rule as
deleting one placement of a shared message today).

### Import
```
ImportBatch      id, workspaceId, kind (contacts | accounts | leads),
                 fileMediaId? → Media, provider(32)? ("csv", "hubspot"…),
                 status ImportStatus (uploaded | mapped | validated | importing |
                                      completed | failed | cancelled | reverted)
                 mapping Json, options Json (dedupe policy, default owner, lead source)
                 totalRows, createdCount, matchedCount, skippedCount, errorCount  [derived]
                 createdById, actionExecutionId?, createdAt, finishedAt?
ImportRow        id, batchId, rowNumber, raw Json, status (pending | created | matched |
                 skipped | error), errorCode?, contactId?, accountId?, leadId?
                 @@unique([batchId, rowNumber])
```
`ImportRow.status` also has `needs_review` (ambiguous match, §4.1). Raw rows are PII:
pruned `IMPORT_ROW_RETENTION_DAYS` (default 30) after the batch finishes; batch counts and
the CRM rows' `importBatchId` survive pruning.

### Connection (provider accounts; shared by Inbox + Calendar)
```
Connection       id, workspaceId, memberId (who connected it),
                 provider (google | microsoft | imap),
                 externalAccountId(255), email(255)?, scopes Json,
                 status (active | needs_reauth | revoked | error),
                 secretRef(255)   ← pointer to encrypted token storage, never the token
                 syncState Json?, lastSyncedAt?, createdAt
                 @@unique([workspaceId, provider, externalAccountId])
```

---

## 4. The four domains

### 4.1 Contacts
```
Contact          id, workspaceId,
                 firstName(80)?, lastName(80)?, displayName(160)   [derived if blank]
                 title(120)?, avatarMediaId?,
                 status ContactStatus (active | archived)
                 ownerMemberId?, teamId?,
                 primaryEmail(255)?, primaryPhone(40)?           [derived from ContactPoint]
                 lastActivityAt?                                  [derived]
                 + provenance block (§7)
                 mergedIntoId? → Contact, createdById?, createdAt, updatedAt, deletedAt?
                 @@index([workspaceId, displayName]) @@index([workspaceId, ownerMemberId])
                 @@index([workspaceId, lastActivityAt])

ContactPoint     id, workspaceId, contactId,
                 kind (email | phone | url | social), value(255), normalized(255),
                 label(40)?, isPrimary,
                 shared Boolean   (role/shared address: info@, sales@, a household inbox)
                 live Boolean     [derived: contact live] — keeps the match index tight
                 @@index([workspaceId, kind, normalized, live])     ← NOT unique

Account          id, workspaceId, name(160), domain(255)?, domainKey(255)? (normalised),
                 website(255)?, industry(80)?, sizeBand(16)?,
                 type AccountType (prospect | customer | partner | vendor | other)
                 status (active | archived), parentAccountId?,
                 ownerMemberId?, teamId?, lastActivityAt? [derived]
                 + provenance, mergedIntoId?, timestamps, deletedAt?
                 @@index([workspaceId, domainKey]) @@index([workspaceId, name])  ← NOT unique

ContactAccount   id, workspaceId, contactId, accountId, role(80)?, isPrimary,
                 startedAt?, endedAt?       (job changes keep history)
                 @@unique([contactId, accountId])  @@index([accountId])

Tag              id, workspaceId, name(40), color(16)?   @@unique([workspaceId, name])
ContactTag / AccountTag / DealTag   (tagId, recordId) @@id, @@index([tagId])
```
- **Email is a strong match signal, not identity** (decision D2). There is no unique
  constraint on email. One matcher (`contacts/match.ts`) is used by import, inbox
  resolution, attendee resolution and manual create:

  | Candidates for a normalised email (live, `shared = false`) | Result |
  |---|---|
  | exactly 1 | **strong match** → reuse (import `matched`, inbox auto-link) |
  | 0 | no match → import creates; inbox/calendar leave unresolved (never auto-create people from email) |
  | ≥ 2 | **ambiguous** → import row `needs_review`; inbox shows candidates, links none |
  | only `shared` points | never auto-matched; import treats it as no match unless the user maps it |

  `shared` is set by a role-address list (info@, sales@, support@, noreply@…) and by hand
  ("this is a shared address"). Manual create shows "possible duplicate" (same email, or
  same name + account) but never refuses.
- **Duplicates are expected and handled, not prevented:** a query-time duplicate review
  (same normalised email, same name+account) feeds the existing merge (pressure test 10).
  Imports run one batch at a time per workspace so a single import can't race itself into
  duplicates; it also dedupes within the file before writing.
- Account domain follows the same rule (subsidiaries/regions share domains): exactly one
  live account for a `domainKey` = strong match, more = ambiguous. Free-mail domains
  (gmail.com…) never become account domains.
- Primary account = `ContactAccount.isPrimary` (at most one live; service rule).

### 4.2 Sales
```
Pipeline         id, workspaceId, name(80), isDefault, position, currency char(3)?,
                 archivedAt?   @@index([workspaceId, position])
PipelineStage    id, workspaceId, pipelineId, name(60), position,
                 category StageCategory (open | won | lost),
                 probability Int (0–100), archivedAt?
                 @@index([pipelineId, position])

Lead             id, workspaceId, contactId → Contact, accountId?,
                 status LeadStatus (new | working | nurturing | qualified |
                                    disqualified | converted)
                 leadSource(80)?  (marketing attribution — "webinar", "referral")
                 score Int?, disqualifyReason(120)?,
                 ownerMemberId?, teamId?, nextActionAt? [derived],
                 convertedAt?, convertedDealId? @unique,
                 liveOpenKey(32)?   ← contactId while status ∉ {disqualified, converted}
                 + provenance, timestamps, deletedAt?
                 @@unique([workspaceId, liveOpenKey])   (one open lead per contact)
                 @@index([workspaceId, status, ownerMemberId])

Deal             id, workspaceId, name(160), pipelineId, stageId,
                 status DealStatus (open | won | lost)      [derived from stage.category]
                 amount Decimal(18,2)?, currency char(3),
                 probability Int?   (override; null → stage default)
                 expectedCloseOn Date?, closedAt?, lostReason(120)?,
                 accountId?, primaryContactId?, leadId? @unique (origin),
                 ownerMemberId?, teamId?,
                 stageEnteredAt   [derived], nextActionAt? [derived], lastActivityAt? [derived]
                 + provenance, timestamps, deletedAt?
                 @@index([workspaceId, pipelineId, stageId])
                 @@index([workspaceId, ownerMemberId, status])
                 @@index([workspaceId, status, expectedCloseOn])

DealContact      id, workspaceId, dealId, contactId, role(60)?   @@unique([dealId, contactId])
DealStageChange  id, workspaceId, dealId, fromStageId?, toStageId, actorMemberId?,
                 at, actionExecutionId?   @@index([dealId, at]) @@index([workspaceId, toStageId, at])
```
- **Lead is a qualification record about a Contact**, not a second copy of person data.
  Importing leads creates/matches Contacts (+Accounts) and opens a Lead on each (D1).
- **Next action** is not a free-text field: it is the earliest of (open `Task` linked to
  the lead/deal, by `dueAt`) and (upcoming non-cancelled `CalendarEvent` linked to it, by
  `startAt`); `nextActionAt` is that date, recomputed whenever a linked task/event or a link
  changes. "No next action" = a real, queryable state.
- **Conversion keeps history where it is** (decision D1): the lead's tasks/events/notes stay
  linked to the Lead and gain a Deal link; nothing is moved.
- `DealStageChange` is canonical history (velocity/conversion reports); the timeline gets
  a `deal.stage_changed` Activity pointing at it.

### 4.3 Tasks (rev 2: split from Calendar)

**Decision (D6): tasks and calendar events are separate models; the Calendar surface
projects both.** One table would have to grow in two directions at once. Tasks are headed
for work management (priority, assignment history, subtasks, dependencies, project
membership, effort, status workflows, checklists). Events need attendees, RSVP,
conference links, recurrence and busy-time semantics. Shared columns would mostly be
NULL, and every query would branch on `kind`. Kept apart, each model can grow without
affecting the other. The one thing they share, "what's next / what's due", is a
query-time union (below).

Naming: **`Task`**, not `WorkItem`. `Item` already means a conversation placement
(`RE:007`), and `WorkItem`/`Item` side by side would be a lasting source of confusion. If
work management later needs other card types (bugs, requests), they become `Task.type`
values or their own models, not a generic record.

```
Task             id, workspaceId,
                 title(300), description Text? (Q-E),
                 type TaskType (todo | call | email | follow_up)   ← presentation/filtering only
                 status TaskStatus (open | in_progress | blocked | done | cancelled)
                 priority TaskPriority (none | low | medium | high | urgent) = none
                 dueAt?, dueAllDay Boolean, startOn Date? (planned start; timelines later)
                 assigneeMemberId?, teamId?, createdById?,
                 parentTaskId? → Task          (subtasks; depth capped at 1 in V1)
                 position Float                (manual order within a list/parent)
                 completedAt?, completedById?, cancelledAt?
                 eventId? → CalendarEvent      ("call Dana" booked as a meeting; optional)
                 + provenance, timestamps, deletedAt?
                 @@index([workspaceId, assigneeMemberId, status, dueAt])
                 @@index([workspaceId, status, dueAt])
                 @@index([parentTaskId, position])
```
Forward-compatibility for work management (not built now, but the shape doesn't block it):
- **Projects/boards:** `Task.projectId?` + `Project` later. A task can be a sales
  follow-up (linked to a deal via `RecordLink`) *and* on a board.
- **Custom status workflows:** today's `status` enum becomes the *category* (the same idea
  as `PipelineStage.category`); a later `TaskStatusDef(projectId, name, category)` adds
  per-board columns while "open vs done" queries keep working.
- **Dependencies, checklists, effort:** own tables (`TaskDependency(taskId,
  dependsOnId)`, `TaskChecklistItem`) or columns (`estimateMinutes`), added when needed.
- **Assignment history:** already covered: every assignee change is an `ActionExecution`
  diff plus an `assignee.changed` Activity; no extra table.
- **Milestones:** project-domain concept, deferred (likely `Task.isMilestone` or a
  `Milestone` model with the project).

A **follow-up** is a `Task` linked (via `RecordLink`) to a lead/deal/contact/account.
`type: follow_up` only affects the label; the link is what makes it count toward
`nextActionAt`.

### 4.4 Calendar
```
CalendarEvent    id, workspaceId,
                 title(200), description Text?, location(255)?, conferenceUrl(512)?,
                 startAt, endAt, allDay, timezone(64)?
                 status EventStatus (confirmed | tentative | cancelled)
                 busy Boolean = true        (free/busy semantics)
                 organizerMemberId?, teamId?,
                 visibility (workspace | private)   ← private hides details, keeps busy time
                 recurrence(255)?, recurrenceId?/originalStartAt?   (RRULE stored, see below)
                 connectionId?, externalCalendarId(255)?, externalId(255)?, iCalUid(255)?, etag(128)?
                 + provenance, timestamps, deletedAt?
                 @@index([workspaceId, startAt]) @@index([workspaceId, organizerMemberId, startAt])
                 @@unique([connectionId, externalId])

CalendarAttendee id, workspaceId, eventId, memberId?, contactId? [derived: resolved],
                 email(255)?, name(160)?,
                 role (organizer | required | optional),
                 response (needs_action | accepted | declined | tentative)
                 @@unique([eventId, attendeeKey])  attendeeKey = member:/contact:/email:
                 @@index([contactId]) @@index([memberId])

Reminder         id, workspaceId, taskId? | eventId? (exactly one), memberId (who is reminded),
                 remindAt, channel (in_app) ← email added later (D7),
                 status (pending | sent | cancelled | failed), sentAt?
                 @@index([status, remindAt])
```
- **Events are things with a time box:** meetings, holds, appointments. No `kind`; it's a
  meeting when it has attendees. No completion state: a meeting happened or was cancelled.
  "Log the outcome" = a Note linked to the event and the deal.
- **Recurrence (D9):** RRULE stored now; V1 shows recurring events as the series row
  (first instance + "repeats" label). Synced exceptions are kept as their own rows via
  `recurrenceId/originalStartAt`, so a later expansion engine doesn't need a migration.
- **The Calendar surface is a projection** (query-time, no copies): events in range
  (`startAt`), open tasks with `dueAt` in range (shown as due items, not blocks), and
  open deals' `expectedCloseOn` (optional layer). Project milestones join that union later.
- **Reminders** are in-app first (D7): a fired reminder raises one `InboxItem` for the
  reminded member (doc/11). Email delivery comes later. This is the first piece of the
  notifications parking-lot item, scoped to reminders only.

### 4.5 Inbox

**Postponed (2026-10-05).** The inbox to build is doc/11: `InboxItem` plus `Compose`.
The mailbox, thread, and participant sketch below waits until external email needs its
own model. Building it now would make Inbox a mail product. When that model exists, it
raises an `InboxItem` whose source is the thread.

```
Mailbox          id, workspaceId, connectionId?, address(255), name(80),
                 kind (personal | shared), teamId? (shared queue), status (active | paused)
                 @@unique([workspaceId, address])

InboxThread      id, workspaceId, mailboxId, subject(500),
                 status ThreadStatus (open | snoozed | done | spam | trash)
                 snoozedUntil?, assigneeMemberId?, teamId?,
                 firstMessageAt [derived], lastMessageAt [derived], messageCount [derived],
                 lastInboundAt? [derived], awaitingReply Boolean [derived]
                 externalThreadId(255)?   @@unique([mailboxId, externalThreadId])
                 @@index([workspaceId, mailboxId, status, lastMessageAt])
                 @@index([workspaceId, assigneeMemberId, status, lastMessageAt])

InboxThreadState id, threadId, memberId, lastReadAt?, starred   @@unique([threadId, memberId])

InboxMessage     id, workspaceId, threadId,
                 direction (inbound | outbound | internal_note)
                 status MsgStatus (draft | queued | sending | sent | failed | received)
                 subject(500)?, snippet(300), bodyText MediumText?, bodyHtmlKey(255)?
                    (large HTML stored like media, by key)
                 sentAt?, receivedAt?, authorMemberId? (outbound/notes),
                 rfcMessageId(512)?, inReplyTo(512)?, references Text?,
                 externalId(255)?, sendActionId? → ActionExecution, errorCode(60)?
                 @@unique([threadId, externalId])  @@index([workspaceId, rfcMessageId(191)])
                 @@index([threadId, sentAt])

InboxParticipant id, workspaceId, messageId,
                 role (from | to | cc | bcc | reply_to), address(255), normalized(255),
                 name(160)?, contactId? [derived: resolved], memberId? [derived]
                 @@index([workspaceId, normalized]) @@index([contactId])

InboxAttachment  id, messageId, mediaId → Media, position   @@unique([messageId, mediaId])
```
- Participants are **per message** (email truth); thread participants are derived.
- `contactId` on a participant is a resolution cache, re-run when a ContactPoint is added
  or contacts merge. The canonical value is the address.
- `internal_note` = a comment on a thread for teammates, *not* a second chat system — real
  discussion happens in a linked conversation (D3).
- Drafts are rows with `status: draft`; sending is a `pending` `inbox.send`
  ActionExecution that moves the message `queued → sending → sent|failed`.
- Inbound attachment `Media.ownerId` = the connecting member's user (Media requires an owner).

---

## 5. Canonical vs derived

| Canonical (source of truth) | Derived (stored, recomputed in-tx) | Derived (query-time only) |
|---|---|---|
| Contact, ContactPoint, Account, ContactAccount | Contact.primaryEmail/primaryPhone, displayName (if blank) | |
| Lead.status, Deal.stageId, DealStageChange | Deal.status (from stage category), Deal.stageEnteredAt | effective probability (`probability ?? stage`) |
| Task, CalendarEvent (+ attendees, reminders) | Lead/Deal.nextActionAt; ContactPoint.live | weighted pipeline value |
| InboxItem, Compose (doc/11) | | account rollups (open deals, contacts) |
| RecordLink, Note→Message | *.lastActivityAt; attendee.contactId | Calendar surface (events ∪ due tasks ∪ close dates); duplicate candidates |
| ActionExecution, Activity, ActivitySubject (append-only) | ImportBatch counts | timelines (ActivitySubject join) |

---

## 6. Linking to conversations without ownership

- A conversation (`Room`) or a moment in it (`Item`) is an **object** in `RecordLink`, the
  same as a thread or event. A deal can link to many rooms; a room can link to records in
  several workspaces.
- **Direction of trust:** a room tile showing "linked: Acme renewal" is rendered only for
  viewers who are active members of that deal's workspace *and* pass its record policy.
  Everyone else sees nothing (not even a redacted chip — same "don't leak existence" rule
  as private rooms).
- **Lifecycle independence:** room soft-delete leaves links (they render as "conversation
  deleted"); record soft-delete hides its chip in the room. Neither cascades.
- **No content copy:** linking a voice message to a deal does not copy the `Message`; the
  deal timeline gets a `conversation.linked` Activity with `roomId/itemId`, and playback
  re-checks room visibility at read time.
- **Rooms do not get a `workspaceId`** in this proposal (D5): conversations stay
  platform-level. If "workspace-internal rooms" are wanted later, that's an additive
  nullable column with its own access rule.

---

## 7. Provenance block (on Contact, Account, Lead, Deal, Task, CalendarEvent)

```
origin            RecordOrigin (manual | import | inbox | calendar | conversation | api | sync)
importBatchId?    → ImportBatch
externalProvider? (32)   "hubspot", "google", "csv"
externalId?       (255)
@@unique([workspaceId, externalProvider, externalId])     (NULLs don't collide)
createdById?      → WorkspaceMember
```
Two things that are easy to conflate are kept apart: **origin** (how the row was created)
vs **leadSource** (marketing attribution: why the person showed up). A row synced from two
providers needs an `ExternalRef` table; deferred until a second sync source exists (D13).

---

## 8. Shared infrastructure vs domain-specific

| Shared (backbone) | Domain-specific |
|---|---|
| Workspace, WorkspaceMember, WorkspaceInvite, Team, TeamMember | Contact, ContactPoint, Account, ContactAccount |
| ActionExecution (audit/idempotency), Activity + ActivitySubject | Lead, Pipeline, PipelineStage, Deal, DealContact, DealStageChange |
| RecordLink, Note, Tag (+ per-domain tag joins), Reminder | Task; CalendarEvent, CalendarAttendee |
| ImportBatch/ImportRow, Connection | InboxItem, Compose (doc/11). Mailbox and threads postponed (§4.5) |
| Provenance block, live-key pattern, contact matcher, policy module | |

**Permission-ready, not permission-complete.** Columns that a policy needs exist now
(`ownerMemberId`, `teamId`, event `visibility`, mailbox `kind`). V1 policy, in one
`policy.ts` (`can(member, verb, record)`), used by every service:
- owner/admin: everything in the workspace;
- member: all contacts/accounts/leads/deals/tasks/workspace events; their own inbox items
  only (`InboxItem.memberId`); private events of others = busy only. Shared-mailbox
  visibility waits with §4.5.
Grants/ACL tables are deliberately **not** proposed yet.

---

## 9. Pressure tests

**1. Import 500 leads from CSV** (40 emails already exist, 3 rows duplicate each other,
12 rows have no email/name).
`ImportBatch(uploaded)` + file `Media` → mapping saved (`mapped`) → validation dry-run fills
`ImportRow.status/errorCode` without touching CRM tables (`validated`; user sees "448 new,
40 match existing, 12 errors, 2 need review") → run (`importing`): per row in chunks,
normalise email → contact matcher (§4.1): one live candidate → reuse; none → create
`Contact`; several, or only a shared address → `needs_review` (the user picks a contact or
"create new", then those rows run). Domain → same rule for `Account` (skip free-mail) +
`ContactAccount`; open `Lead` unless `liveOpenKey` says one is already open (→ `matched`).
The 3 in-file duplicates are collapsed before writing (row 1 creates, rows 2–3 `matched`). Everything carries `origin: import, importBatchId`. One parent
`ActionExecution` (`import.run`, idempotency key = batch id → re-clicking does nothing),
one `import.completed` Activity (not 500). **Revert** = soft-delete rows created by the
batch that nobody has touched since (`updatedAt` = creation) → status `reverted`.
✔ Holds without an email unique constraint, because only one batch runs per workspace at a time
and in-file dedupe happens first. Pressure point: the "default owner / round-robin" option lives in `options`.

**2. Convert lead → deal.** One transaction: create `Deal` (pipeline default, first open
stage, `leadId`, account/primary contact from lead, owner from lead), `DealContact`,
`DealStageChange(from: null)`, Lead `status: converted, convertedAt, convertedDealId`,
`liveOpenKey = NULL`; the lead's open tasks/events/notes keep their Lead links and **gain** a
Deal link (D1, nothing moves); `nextActionAt` computed for the deal; `ActionExecution(lead.convert)`; Activity `lead.converted` with
subjects lead + deal + contact + account. ✔ The contact is never duplicated.

**3. Schedule a follow-up for a deal.** `Task(type follow_up, dueAt, assignee)` +
`RecordLink(dealId, taskId)` + `Reminder(taskId, assignee, remindAt, in_app)` → recompute
`Deal.nextActionAt`. It appears on the Calendar surface as a due item on that day. Booking
it as a call with the customer = a `CalendarEvent` (attendee = the contact) linked to the
deal, with `Task.eventId` pointing at it. Completing the task → `status done` → Activity
`task.completed` → `nextActionAt` moves to the next open task/upcoming meeting or `NULL`
("deals with no next step" view). ✔ The meeting needs no completion state; the outcome is
a Note.

**4. Receive an email.** *(Postponed with §4.5; the inbox item is doc/11.)* Sync (an `integration` ActionExecution per batch, not per mail)
upserts `InboxThread` by `(mailboxId, externalThreadId)` (fallback: `inReplyTo` →
`rfcMessageId`), inserts `InboxMessage` idempotently by `(threadId, externalId)`,
participants resolved by the contact matcher (only unambiguous, non-shared matches), attachments → `Media` +
`InboxAttachment`. Thread → `open`, counters recomputed, `awaitingReply = true`. Auto-link:
for each resolved contact, `RecordLink(contact, thread, how: auto_match)`; Activity
`email.received` with subjects = those contacts (+ their primary accounts). Deals are
**not** auto-linked in V1 (Q-A). ✔

**5. Send an email (later slice).** *(Postponed with §4.5. Until then, `Compose` records the follow-up and does not send.)* Draft `InboxMessage(outbound, draft)` → Send creates
`ActionExecution(inbox.send, pending, idempotencyKey = messageId)`, message `queued`; a
worker sends via the connection, stores `externalId/rfcMessageId`, `sent` (or `failed` +
`errorCode`, draft kept for retry — same rule as media upload failure). Activity
`email.sent`. ✔ Idempotency key prevents double-sends on retry.

**6. Attach an email thread to a contact/account/deal manually.** `RecordLink` per
subject (`how: manual`), Activity `thread.linked` with those subjects so the deal
timeline shows it immediately; the thread's past messages appear on the deal timeline via
the link: its existing message activities gain this subject (Q-B). Unlink deletes the link + `link.removed`
activity. ✔

**7. Assign owner (and a member leaves).** `ownerMemberId` update →
`ActionExecution(changes: {ownerMemberId: [a, b]})` + Activity `owner.changed`. When a
member is removed: `status: removed`, and a required **reassignment step** moves their
open leads/deals/threads/tasks and future events they organise to another member in one action (counts shown first).
Closed records keep the removed member as historical owner. ✔ That's why owners point at
`WorkspaceMember`.

**8. Move a deal through the pipeline.** Set `stageId` → derive `status` from category
(won/lost sets `closedAt`; lost requires `lostReason`), `stageEnteredAt = now`,
`DealStageChange`, Activity `deal.stage_changed`. Moving a stage of another pipeline =
`pipeline.change` action (both FKs change). Archiving a stage with live deals is refused
until they're moved. ✔

**9. Show an activity timeline** (contact / account / deal). `ActivitySubject where dealId
= ? order by occurredAt desc` keyset-paginated, then hydrate referenced rows by arc
column. Account timeline = its own subjects ∪ its contacts' (`ContactAccount`) — one
`IN` query on `contactId` + `accountId` indexes; capped contact fan-out. ✔

**10. Merge two contacts.** Move ContactPoints (dedupe), ContactAccounts, Leads (respect
one-open-lead), DealContacts, RecordLinks (dedupe by pairKey), ActivitySubjects,
attendees, participants → winner; loser `mergedIntoId`, `deletedAt`, its points `live = false`.
This is also how duplicates found by the matcher or the duplicate review get resolved.
Old URLs redirect via `mergedIntoId`. ✔ This is the reason subjects are FK columns, not
strings — every reference is findable.

**11. Link a deal to a conversation.** In a room, "link to deal" → `RecordLink(dealId,
roomId, itemId?)`; viewers outside the workspace see nothing (§6). ✔

---

## 10. Phasing

| Slice | Contents | Depends on |
|---|---|---|
| 0 | Workspace, Member, Invite, Team, ActionExecution, Activity(+Subject), policy module, same-workspace invariant test | — |
| 1 | Contacts (Contact, Point, Account, ContactAccount, Tag), matcher, Note, RecordLink, Import | 0 |
| 2 | Sales (Pipeline, Stage, Lead, Deal, DealContact, DealStageChange) + **Task** + in-app Reminder (follow-ups and `nextActionAt` need tasks) | 1 |
| 3 | Calendar (internal events, attendees, Calendar surface projecting events ∪ tasks ∪ close dates) | 0, 1, 2 |
| 4 | Inbox attention queue (`InboxItem`) + shared composer (`Compose`). Mail threads, sync, and campaigns postponed (doc/11) | 1 |

Each slice: schema + OpenAPI + SDK hooks + server tests; migrations are additive.

---

## 11. Decisions (recorded 2026-10-05)

| # | Decision |
|---|---|
| D1 | **Lead = qualification record over a Contact.** No separate lead-person universe. On conversion, existing tasks/events/notes stay linked to the Lead and gain a Deal link; nothing is moved. |
| D2 | **Email is a strong match signal, not identity.** No unique constraint on email (or account domain). One matcher: exactly one live, non-shared candidate = match; several = ambiguous/review; shared/role addresses never auto-match. Duplicates handled by review + merge. |
| D3 | **Attention is a workspace event, presented in the shared channel** (doc/11, 2026-10-06). One `ActivityEvent` per business event; optional chat line. Per-member Inbox delivery and the Inbox desk wait for real inbound mail. A reusable composer addresses a contact on a channel (email first). People-to-people collaboration stays in Conversations. |
| D4 | **V1 visibility is broad**: members see all CRM data. `ownerMemberId`/`teamId` columns now, all checks through one `policy.ts`, no ACL/grant tables. |
| D5 | **Rooms stay platform-level.** No `Room.workspaceId`; workspace-internal conversations later, when there's a concrete access requirement. |
| D6 | **`Task` is separate from `CalendarEvent`**; the Calendar surface projects both (query-time). Named `Task` (not `WorkItem`, which would sit next to conversation `Item`). Task status enum = future status *category*. |
| D7 | **Reminders in-app first**, email later. The in-app surface is an `InboxItem` (doc/11), not a separate due list. |
| D8 | **Workspace membership requires a registered account** (guests upgrade first). |
| D9 | **Recurrence:** RRULE stored (+ exception rows for synced series); no expansion engine yet. |
| D10 | **Notes can be shared into conversations**, creating an Item via the existing author-only share. Deleting a note doesn't remove its room placements. |
| D11 | **Bots are not WorkspaceMembers**; `actorKind: agent` stays reserved (doc/08 §4.9 binding). |
| D12 | **Raw import rows** pruned after `IMPORT_ROW_RETENTION_DAYS`, default 30. |
| D13 | **Integrity:** service same-workspace assertions + invariant tests for the POC; `ExternalRef` waits for a second provider per record. Revisit composite FKs before broad rollout or the first external API/sync writer. |
| D14 | **Money:** `Decimal(18,2)`, string in the API. |
| D15 | **Multiple workspaces per user** supported in the model; the UI switcher waits. |

### Remaining small questions (defaults proposed; none block the backbone or Contacts)

Q-A through Q-D belong to the postponed mail model (§4.5). They do not shape `InboxItem` or `Compose`.

- **Q-A Auto-link email to deals.** Proposed: never auto-link; when the resolved contact
  has exactly one open deal, *suggest* it (one-tap link). Query-time, no schema impact.
- **Q-B Timeline for a linked thread.** Proposed: every ingested/sent message writes its
  own `email.*` Activity (with `Activity.threadId` denormalised). Linking a thread to a
  subject adds `ActivitySubject` rows for that thread's existing activities; unlinking
  removes them. Timelines stay one indexed query; no join to threads at read time.
- **Q-C Sync-originated changes** (RSVPs, provider edits): covered by the per-sync-batch
  `integration` ActionExecution; no execution per change. Activity only where people care
  (`event.rsvp` yes, etag bumps no).
- **Q-D Email body retention.** Proposed: kept while the thread exists; disconnecting a
  mailbox offers "keep history" vs "delete synced mail".
- **Q-E Task description.** Proposed: plain `Text` in V1 (voice notes about the work go
  on the linked deal/contact as Notes). Revisit if tasks need rich/voice bodies.

---

## 12. Slice 0 — as built (2026-10-05)

**Schema** (additive; existing tables untouched apart from two back-relations on `User`):
`Workspace`, `WorkspaceMember`, `WorkspaceInvite`, `Team`, `TeamMember`, `ActionExecution`,
`Activity`, `ActivitySubject` + enums `WorkspaceRole`, `MemberStatus`, `TeamRole`,
`ActorKind`, `ActionOrigin`, `ActionStatus`.

**Server**
- `services/workspacePolicy.ts`: `can(member, verb, target?)` (pure) + `authorize()`
  (load membership → 404 for non-members/removed/deleted workspace, 403
  `MEMBER_SUSPENDED`) + `permit()` for target-dependent checks. Only owners touch
  owners; team leads manage their own team's membership.
- `services/actions.ts`: `runAction()` writes the `ActionExecution` and its `Activity`
  rows in the mutation's transaction; field diffs via `diff()`; `Idempotency-Key`
  replay (same action + input → previous result; different → 409
  `IDEMPOTENCY_KEY_REUSED`). Refusals raised inside an action (e.g. `LAST_OWNER`) are
  recorded as `rejected`, crashes as `failed`; up-front validation and authorization
  failures are not recorded.
- `services/workspaceIntegrity.ts`: `crossWorkspaceViolations()` (raw SQL per FK pair);
  each domain adds its pairs.
- `WorkspaceService`, `TeamService`, `handlers/workspaces.ts`; serializers in
  `lib/serialize.ts`. Origin = `ui` with the session cookie, else `api`.

**API** (19 operations, tag `workspaces`): workspaces CRUD (soft delete), members
(list / update / remove-or-leave), invites (create returns the token once, list, revoke,
`POST /workspace-invites/accept`), teams (list / create with `Idempotency-Key` / update
incl. archive / set or remove member), `GET …/activity` (members), `GET …/actions`
(audit, owner/admin). SDK: `hooks/useWorkspaces.ts`.

**Deviations from §3, decided while building**
- `MemberStatus` has no `invited` value: invitations live in `WorkspaceInvite`, so a
  member row starts at acceptance.
- `ActivitySubject` ships with `subjectKey` only; the subject-arc FK columns and their
  timeline indexes come with Contacts/Sales (slice 1/2), since their tables don't exist yet.
- `ActionExecution.parentId` is deferred to the Import slice (its only user).
- Invites are bound to the invited email (the accepting account's email must match), so
  a forwarded link can't be used by someone else. No email is sent yet: the caller
  delivers the token.
- The member-removal reassignment step (§9.7) is a no-op until domains with owners exist.

**Tests:** `workspaces.test.ts`, 32 cases, including a spec-driven check that every
`/workspaces/{workspaceId}…` route is 401 without auth and 404 for non-members (new
routes are covered automatically) and the cross-workspace invariant. Server 261/261.

---

## 13. Slice 1 — as built (2026-10-05)

Scope as narrowed on approval: Contacts + matcher + Notes + RecordLink. **Import is
deferred to its own slice right after** (its first real use, importing leads, needs Slice
2's Lead anyway; mapping, needs-review, one-batch-at-a-time locking, revert and row
retention would have doubled this slice). Contacts are domain capabilities, not
necessarily a page: the same API/hooks serve Work, Sales, Inbox, Team tiles or search.

**Schema** (additive; existing models gain relation fields only): `Contact`,
`ContactPoint`, `Account`, `ContactAccount`, `Tag`, `ContactTag`, `AccountTag`, `Note`,
`RecordLink`; `Activity` gains its object arc (`noteId`, `roomId`, `itemId`);
`ActivitySubject` gains `contactId`/`accountId` with timeline indexes. Enums
`RecordStatus`, `RecordOrigin`, `ContactPointKind`, `AccountType`, `LinkOrigin`.

**Server**
- `contactMatch.ts`: the one matcher (D2) — role-address list → `shared`, free-mail domains,
  point normalisation (email/phone/url/social), `matchContactsByEmail` (match / ambiguous /
  shared / none), `matchAccountsByDomain`.
- `ContactService` (create reports `duplicates`, never refuses; points replace; derived
  `displayName`/`primaryEmail`/`primaryPhone`; contact–account links with one primary and
  `endedAt` history; duplicates; **merge** moving points, accounts, tags, links and timeline
  subjects with dedupe, the loser resolving to the survivor), `AccountService` (domain
  normalisation, same-domain report, `FREE_MAIL_DOMAIN`, parent cycles refused),
  `TagService`, `NoteService`, `LinkService`, `records.ts` (assignee/tag checks, timeline
  query, room visibility, redaction).
- Policy: `record.read|write` for every member; `record.delete` (delete, merge-away) for
  admins + the record's owner; `note.delete` for admins + the author; `tag.manage` admins.
- `runAction` drafts carry `subjects` and an `object`; `lastActivityAt` only moves forward.
- Integrity checks for all 23 new same-workspace pairs.

**API**: 30 operations — contacts (list/search/filter, create, get, update, delete, match,
duplicates, merge, timeline, set/remove account), accounts (list, create, get, update,
delete, timeline), tags (list, create, update, delete), notes (list by subject, create,
get, pin, delete, share), links (list, create, delete) and `GET /rooms/{roomId}/links`
(the room tile). SDK: `hooks/useContacts.ts`.

**Decisions made while building**
- **Account timeline** = the account's own activity + what happened to the people
  currently there *since they joined* (`startedAt`, else link creation), not their earlier
  history elsewhere.
- **Linking rules (Q-B applied)**: linking a note adds the subject to the note's existing
  activities (it appears at its original time); linking a conversation writes
  `conversation.linked`. Unlinking removes the subject from those activities and writes
  `link.removed`. Deleting a note removes it from timelines.
- **Privacy of rooms (§6)**: a room can only be linked by someone who can see it; links and
  timeline entries show a room the viewer can't see without its id or title; the room tile
  lists links only from workspaces the viewer is an active member of.
- **D10 refined**: deleting a capture in a room purges it everywhere (`purgeCapture`, the
  current product rule), so a shared note's content can disappear — the note then reports
  `contentRemoved: true`. Deleting a note never removes its placements; a never-shared note
  is purged (file, media row, text).
- Not yet: `Contact.avatarMediaId`, account merge (`Account.mergedIntoId`) and
  `importBatchId` — each comes with the feature that uses it.

**Tests**: `contacts.test.ts` (18) + the spec-driven access guard now covers 49
workspace routes. Server 309/309.
