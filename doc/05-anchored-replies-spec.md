# Anchored Replies — Spec Draft (POC)

**Status:** approved and implemented (2026-10-01) — decisions in §6 approved as proposed. Added during implementation: an anchor is a **moment** (point, not segment); it is captured when REPLY HERE is chosen (not at Send) and shown through reply/compose/record/review as `RE:014 · 01:52`.

**Goal:** let a reply attach to a moment in its parent's audio/video, and show those moments on the parent's progress bar / waveform. "Media becomes geography."

**Out of scope for this POC:** pause-and-resume "play with replies" weaving, text-range anchors, image regions, server-side media probing, anchor editing.

---

## 1. Contract

### Operation (existing route, extended input)

```
POST /items/{itemId}/replies        replyToItem
{
  text?:          string   (≤ 4000)
  mediaIds?:      string[] (≤ 10, unique)
  anchorStartMs?: integer  (≥ 0)          ← new, optional
}
→ 201 { data: Item }
```

`sendMessage` is **unchanged** and does **not** accept `anchorStartMs` (top-level messages have no parent to anchor into). Today `replyToItem` reuses `SendMessageInput`; it gets its own `ReplyToItemInput` so the two can diverge.

### `Item` gains one field

```
Item {
  id, roomId, messageId, number, parentId, message, reactions, createdAt, deletedAt,
  anchorStartMs: integer | null      ← new; null = un-anchored (all existing items)
}
```

Because it lives on **Item** (room placement), not **Message** (content):

- the same video shared into rooms A and B carries **independent** maps of moments;
- `shareMessageToRooms` copies **no** replies (it never did), so no anchored replies travel with a share;
- SSE `item.created` / `item.updated` carry the field automatically (they send `Item`).

### OpenAPI diff

```yaml
  /items/{itemId}/replies:
    post:
      operationId: replyToItem
      requestBody:
        content:
          application/json:
-           schema: { $ref: '#/components/schemas/SendMessageInput' }
+           schema: { $ref: '#/components/schemas/ReplyToItemInput' }

components:
  schemas:
+   ReplyToItemInput:
+     type: object
+     additionalProperties: false
+     properties:
+       text: { type: string, maxLength: 4000 }
+       mediaIds:
+         type: array
+         maxItems: 10
+         uniqueItems: true
+         items: { type: string, minLength: 1, maxLength: 64 }
+       anchorStartMs:
+         type: integer
+         minimum: 0
+         description: |
+           Moment in the parent's timed media (ms from start) this reply responds to.
+           Only valid when the parent has exactly one visible audio/video attachment
+           with a known duration; must be ≤ that duration.

    Item:
-     required: [id, roomId, messageId, number, parentId, message, reactions, createdAt, deletedAt]
+     required: [id, roomId, messageId, number, parentId, anchorStartMs, message, reactions, createdAt, deletedAt]
      properties:
+       anchorStartMs:
+         type: [integer, 'null']
+         minimum: 0
+         description: Moment in the parent's media this reply anchors to; null when un-anchored.
```

### Prisma diff

```prisma
 model Item {
   ...
   parentId      String?
+  // Moment in the parent's timed media this reply responds to (ms). Placement-level:
+  // the same Message shared elsewhere has its own, independent anchors.
+  anchorStartMs Int?
   ...
+  @@index([parentId, anchorStartMs])  // markers for a parent, in timeline order
 }
```

Nullable column, no backfill: every existing item is un-anchored.

---

## 2. Validation rules (server, `ItemService.reply`)

| # | Rule | Failure |
|---|---|---|
| 1 | `anchorStartMs` optional; absent → behaves exactly as today | — |
| 2 | Integer ≥ 0 (schema) | 400 `VALIDATION` |
| 3 | Parent must be **media-backed**: its Message has a timed (audio/video) attachment that is **visible** (parent placement not deleted) | 400 `ANCHOR_UNSUPPORTED` |
| 4 | That attachment's duration must be known (`Media.duration` not null) | 400 `ANCHOR_UNSUPPORTED` |
| 5 | `anchorStartMs ≤ round(duration × 1000)` | 400 `INVALID_ANCHOR` |
| 6 | Room still comes from the parent (unchanged — replies can't jump rooms) | — |
| 7 | Any number of replies may share the same `anchorStartMs` | — |

Checks run before the transaction, alongside the existing EMPTY_ITEM / visibility checks, so a rejected anchor creates nothing.

---

## 3. Semantics that stay exactly as they are

- **Graph:** an anchored reply is an ordinary child (`parentId`). Branches, depth, `RE:` references, tombstones, share and reactions are unchanged.
- **Playback order:** chronological and follow-replies traversal ignore anchors (posting order, as today). No second ordering model in this POC.
- **Replies to anchored replies** are ordinary replies to that reply. They may carry their own anchor only into **that** reply's media (rule 3 applies to the direct parent).
- **Deleted parent placement:** existing anchored replies stay attached (they keep `anchorStartMs`). Markers aren't drawn because the parent's media is hidden. New anchors are rejected (rule 3).

---

## 4. Frontend (POC)

- **SDK:** regenerated. `useReplyToItem` accepts `anchorStartMs`. The `Item` alias picks it up.
- **Adapter / types:** frontend `Item` gains `anchorStartMs?: number`.
- **Reply here:** while an audio/video item is active, "REPLY HERE" captures that element's `currentTime` (→ ms, clamped to duration) and enters the existing reply flow with it. The Instrument label reads `RE:014 · 00:38`. Send passes `anchorStartMs` through `Room.send` → `useReplyToItem`. Plain REPLY stays un-anchored.
- **Markers:** on the parent's progress bar / waveform, one tick per anchored child at `anchorStartMs / durationMs`. Ticks closer than ~6px cluster into one marker with a count (visual only; the data stays individual replies). Style follows the room's visual system: hairline ticks in `--axis` contrast; a cluster turns signal-coloured while it contains the playhead item.
- **Tap a marker:** expands the parent's thread, reveals the first reply at that moment, and marks that cluster's replies as focused. No playback change.
- **Tether:** unchanged mechanism. For an anchored reply in progress it starts from the marker instead of the numeral.

---

## 5. Tests

**Server (`items.test.ts` → `replyToItem`):**

- anchored reply to an audio parent → 201, `anchorStartMs` echoed, room = parent's room;
- at exactly `duration` → 201; at `duration + 1` → `INVALID_ANCHOR`; negative / non-integer → 400;
- parent with text only → `ANCHOR_UNSUPPORTED`;
- parent with media but `duration` null → `ANCHOR_UNSUPPORTED`;
- parent placement deleted → `ANCHOR_UNSUPPORTED`; nothing created (Message count unchanged);
- two replies at the same anchor → both 201, both listed;
- `sendMessage` with `anchorStartMs` → 400 (unknown field);
- share parent to room B → B's placement has no children; anchors in A unchanged;
- un-anchored reply → `anchorStartMs: null`, behaviour identical to today;
- `listRoomItems` / SSE payloads validate against the updated schema.

**Browser:**

- REPLY HERE at ~1.5s into a 2s clip → marker at ~75% of the bar;
- clustering: 3 replies within 100ms → one marker with "3";
- tapping a marker expands the thread and reveals the anchored reply;
- markers update live when another user anchors a reply (SSE);
- playback order unchanged with anchors present (existing suites still pass).

---

## 6. Decisions needed before implementation

1. **Which attachment does an anchor refer to?** A message can hold up to 10 media. Proposed for the POC: anchors are allowed only when the parent has **exactly one** timed attachment (rule 3). The alternative is an `anchorMediaId` field now. I'd defer it until multi-clip messages actually exist in use.
2. **Duration is uploader-reported.** `Media.duration` comes from the client at upload, and the server never probes the file. So rule 5 is only as trustworthy as the uploader's client. That's acceptable for a POC because a bad value only misplaces markers. Phase 2: probe duration server-side (e.g. ffprobe on upload).
3. **Missing duration:** rule 4 rejects anchors when duration is unknown. The alternative is to accept them without an upper bound and hide their markers. Rejecting keeps the data clean; it's the proposal.
4. **Marker granularity:** store ms, render clustered. No server-side bucketing.
