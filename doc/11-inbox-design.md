# 11 — Inbox: attention and follow-up

**Status:** Design, recorded 2026-10-05. This is the inbox to build. It supersedes doc/09 D3 and §4.5.
**Date:** 2026-10-05

Inbox tells the member what needs attention and opens the fastest follow-up. It points at other domains. It stays useful if Sales becomes Inventory.

## 1. Product

- An inbox item is a notification. It is a message only when a real message exists.
- Sources that raise an item: contact activity, replies, reminders, calendar events, form submissions, system notices, and later an external email. Inventory, documents, and conversations use the same pointer.
- The composer starts from a contact and a channel. Email is the first channel. Later providers attach behind the same composer.
- The composer is shared. Contact opens Message. Inbox opens Reply. Calendar opens Follow up.
- There is no member-to-member mail product. People-to-people collaboration stays in Conversations.

## 2. InboxItem

One row is one member's attention on one source. A workspace event that several people should see is written once per member.

```
InboxItem   id, workspaceId, memberId,
            type(32),            reminder | contact | calendar | conversation | system | email …
            title(200), summary(500),
            sourceType(32), sourceId,
            unread Boolean, starred Boolean, archivedAt?,
            action Json,         { verb: 'open' } | { verb: 'compose', contactId, channel: 'email' }
            dedupeKey(160),
            createdAt
            @@unique([memberId, dedupeKey])
            @@index([workspaceId, memberId, archivedAt, createdAt])
```

- `type` is a varchar. A new domain does not add an enum value.
- `sourceType` + `sourceId` is the one object this item is about. `RecordLink` stays the many-to-many relation between records. `Activity` stays the record timeline. The item copies neither.
- The writer checks that a known source exists in the same workspace. An unknown `sourceType` is refused.
- `unread` defaults true. Dismiss and archive are the same state: `archivedAt`. The default list hides archived rows. Trash and assignee are omitted. Assigned-to-me can be a later field.
- `dedupeKey` is a stable event id the producer owns. A retry returns the original item. The title is never part of the key.
- `action.verb = compose` carries the contact and channel used to open the composer. The item stays a pointer to its source.

`raiseInboxItem` is server-only. There is no member route that creates an item. Member routes are list, mark read, star, and archive. Each goes through `runAction` (`inbox.read`, `inbox.star`, `inbox.archive`).

Workspace membership is required. It is not sufficient: the row's `memberId` must be the caller. Owners have no backdoor into another member's queue. CRM visibility (doc/09 D4) is unchanged.

## 3. Composer

One stored follow-up. Not a mailbox, and not a conversation `Message`.

```
Compose     id, workspaceId, authorMemberId, contactId,
            channel(16),         email
            destination(255),    normalizeEmail
            subject(200),        required for email
            body Text,
            contextType(32), contextId,
            createdAt
            @@index([workspaceId, contactId, createdAt])
            @@index([authorMemberId])
```

- `destination` uses `normalizeEmail` (trim + lower-case) from `contactMatch.ts`. The CRM matcher does not choose the address.
- `contextType` + `contextId` is the business object the follow-up is about: the inbox source, the calendar event, or the contact.
- Send validates the payload, writes the row, and writes an activity on the contact. It does not create an inbox item and it does not create a thread.
- Provider delivery is a later worker on this same row. Until that worker exists, the row is the record of the follow-up. It is not a claim that mail left the building.
- Reply from an inbox item opens the composer with `contactId` and the item's source already filled.

The command is `compose.send`, member-facing, through `runAction`. The author is the session member.

## 4. Desk

The Inbox place in `apps/web/src/features/work/WorkPage.tsx` replaces the empty line "Nothing waiting." in `features/work/sections.ts`.

- One list. Filters: unread, starred, archived. No Sent, Drafts, or System folders.
- A row shows title, summary, time, unread, and starred. The row's action opens the source or the composer.
- The composer component is mounted from Contact, Inbox, and Calendar. Those three call sites are the scope.

## 5. Producers

This design invents no product events. Domains call `raiseInboxItem` when they already have a real event.

The first producer, when tasks exist, is the in-app reminder (doc/09 D7). One fired reminder raises one item for the reminded member. That item is the in-app surface, in place of a separate "due now" list.

## 6. Postponed

`InboxThread`, `InboxParticipant`, `InboxMessage`, mailbox sync, Sent / Drafts / System folders, campaign mail, and internal correspondence. Doc/09 §4.5 and pressure tests 4–5 stay as the sketch for a later mail model. When external email arrives, that model keeps its own tables and raises an inbox item whose source is the thread. The item is not the thread.

Campaigns wait until that mail model exists. A saved audience and the list of people actually mailed are different things, and neither is an inbox folder.

## 7. Build order

1. `InboxItem`, `raiseInboxItem`, list, and the three state changes. Tests: another member's item is invisible; archive hides it from the default list and leaves a fanned-out copy untouched; the same `dedupeKey` returns the original row; a member route cannot create an item.
2. `compose.send` and the shared compose surface, wired from Contact, Inbox, and Calendar. Tests: email without subject or destination is refused; send writes the compose row and a contact activity; send creates no inbox item.
3. Reminder producer, when tasks exist.
4. External mail model, later, as a source that raises items.
