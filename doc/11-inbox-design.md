# 11 — Attention events and a future Inbox

**Status:** Revised 2026-10-06. Presentation moved into the workspace channel. The Inbox desk is deferred.
**Supersedes:** the 2026-10-05 “chatty Inbox desk” presentation. Backend event history and Compose remain.

## Product (locked)

- **Business event → one workspace `ActivityEvent` → optional chat presentation** in the shared workspace channel (doc/12).
- Later: `ActivityEvent` → per-user notification / digest / true Inbox delivery. Do **not** fan out one shared event into N nearly identical `InboxItem` rows just to render one channel line.
- `InboxItem` stays recipient-owned (raise / read / star / archive APIs) for that later delivery path. It is **not** the source of shared-channel activity.
- CRM `Activity` / `ActivitySubject` remain the record timeline. Unrelated.
- Curate aggressively. Slice 1 posts only: new contact, recorded follow-up, assistant/workflow completion. Not every CRUD.
- Distinct from ordinary chat: posted with workflow `workspace-activity` (SYSTEM_ACTIVITY). Links deep-open Contacts / Documents / compose.
- Hide Inbox from workspace navigation until real inbound communications (email, SMS, support) need a dedicated queue.

## ActivityEvent

```
ActivityEvent  id, workspaceId,
               type(48), title(200), summary(500),
               sourceType, sourceId,
               links Json?,          MessageLink[] for the channel card
               dedupeKey(160),       @@unique([workspaceId, dedupeKey])
               itemId?,              channel Item once presented
               actorMemberId?,
               deliverAt, createdAt
```

## Compose

Unchanged: shared follow-up to a contact on email. Recording it is not delivery. It raises one `ActivityEvent` and may open Message from a channel link.

## Build order

1. Schema + `recordActivityEvent` + present into workspace channel; hide Inbox nav; silence chatty `runAction` → InboxItem fan-out. *(this slice)*
2. More curated producers (sales stage, follow-up due) and richer action buttons.
3. All | People | Activity filter on the channel.
4. True Inbox when inbound mail exists.
