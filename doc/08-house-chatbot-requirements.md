# 08 — House Chatbot (epic requirements)

Status: requirements, amended after review 2026-10-04 (§2.5 invariants I1–I7 are binding;
§4 is the detailed design for the complex parts).
Scope: all of Phase 1 (1a + 1b). **Status 2026-10-04: Phase 1 built.** Server 213/213;
browser 7/7 (1a) and 14/14 (1b realtime/mute) on an isolated pair.

## 1. Goal

A **house bot** called **chatbot** is present in every conversation and behaves like
another person in the room. It greets people, answers when summoned, posts to the
chat, and puts media on the stage. We use it to test what a meeting with another
participant feels like, before real AI is wired in.

Later bots are optional and can be added to a conversation: **marketing chatbot**,
**technical chatbot**, **buddy chatbot**.

### Non-negotiables

1. **No bot UI.** The frontend renders a bot exactly the way it renders a human: same
   seat or disc, chat row, stage item, avatar and name. If a screen needs a bot branch
   to work, the integration point is wrong.
2. **The bot is a real user in the code.** It has a `User` + `Profile` row and posts
   through the same service path as a human (`ItemService`), so serialization, SSE,
   numbering, room stats, reactions and replies all come for free.
3. **Deterministic first.** Phase 1 has no AI. Behaviour comes from weighted random
   choices over classified, backfilled content, run by timed workflows. Every decision
   can be logged and replayed.
4. **AI comes later, behind a gate.** Phase 2 adds OpenAI calls. The deterministic
   layer still decides whether an AI call happens at all, which agent makes it and
   within what budget.

## 2. Insertion point (findings from the current code)

### 2.1 Server: the bot posts as a user, through services

Humans post through `ItemService.sendMessage(viewerId, roomId, {text, mediaIds, chat})`
and `ItemService.replyToItem(...)`. Both end in `publishCreated()`, which sends
`item.created` on `StreamHub`. Every client then refetches and renders the item.

**The bot calls those same service methods directly, passing its own userId as
`viewerId`.** It does not go through HTTP, so it has no session, cookie or rate
limiter. Everything downstream is unchanged:

| Bot action | Existing path | What the client renders |
|---|---|---|
| Say something in chat | `sendMessage(botId, roomId, { text, chat: true })` | `ChatStream` row (author name, avatar) |
| Put media on stage | `sendMessage(botId, roomId, { text?, mediaIds })` (`chat` false) | Item enters the `RoomFloor` stage queue |
| Reply to a person's item | `replyToItem(botId, itemId, { text, mediaIds? })` | Thread/reply, `RE:014` |
| Stage library media (repeatable) | internal `ItemService.placeExisting(botId, roomId, messageId, { chat, parentId? })`, see I2 | Stage item |
| React | `ReactionService` with botId | Reaction row |

Authorization for all of these goes through `RoomService.authorizeActor()` followed by
`ensureHumanParticipation()` (I1), not `viewable()` + `ensureMember()`.

Dependency: the **`Item.chat` flag** that separates chat from stage is in the working
tree but not committed yet (`schema.prisma`, `openapi.yaml`, `ItemService`,
`useRoomPost`). This epic builds on it.

### 2.2 Server: where the bot hears things

There is no domain event bus today. `StreamHub.publish()` only writes SSE frames. We
add an **in-process event emitter** (`services/events.ts`) and fire events from the
existing seams:

| Event | Seam | Used for |
|---|---|---|
| `item.created` (with author, text, chat, parentId, media kinds) | `ItemService.publishCreated` | summons, replies, conversation reactions |
| `member.joined` | `RoomService.join` (only when a membership row is actually created) | personalized hello |
| `presence.arrived` / `presence.left` | `RoomPresence` (I4), fed by `handlers/stream.ts` subscribe/close | presence-based hello for public-room viewers who never "join"; idle timers |
| `room.created` | `RoomService.create` | house bot seating, opening line |

The bot runtime subscribes to this emitter. The emitter stays single-instance, the
same limitation `StreamHub` has (Redis is already on the V2 parking lot).

**Loop guard:** the runtime ignores events whose actor is a bot, unless a workflow
explicitly opts in (for example, bot-to-bot banter later).

### 2.3 Client: the one real gap is presence

`roomPeopleFrom()` (`features/room/PeopleStrip.tsx`) builds the people list **only from
item authors**, plus "me". `seatsFrom()` builds seats from that list. As a result, a bot
that hasn't posted is invisible, and so is a silent human.

Fix it generically, not for bots: `GET /rooms/{id}/participants` returns members,
present visitors and seated bots, with deduplicated presence. **As built, the seat rule
is:** once the roster has loaded, seats = participants who are present (plus you), and
items only refresh names and avatars. Before the roster loads, the old rule (everyone
who has spoken) applies. So a bot is seated before it speaks, and a removed bot, or a
person who left, gives up their seat, the same for everyone. This closes the open "Live
presence for Blobs" item in CLAUDE.md.

Typing/recording activity: `PresenceActivity` exists only for "me" today. A bot
"typing…" pause before it posts is a nice-to-have. It needs a presence event on the SSE
stream (`presence.updated`), which humans would use too. It is not required for the POC.

### 2.4 What must not change

- No `isBot` checks in components. If the API needs a marker for muting or the owner
  menu, it goes on `User` as data (`kind: 'human' | 'bot'`), and only the
  owner/participant menu reads it.
- Bot items are ordinary `Item`s. Playback, dwell, anchors, follow and traversal treat
  them like anyone else's.

### 2.5 Invariants (binding; added after review)

**I1. A seated bot is an authorized participant. Bots never get membership rows.**
Today `ItemService.send/reply` and reactions call `rooms.viewable()` (private room → 404
without a membership row) and then `rooms.ensureMember()` (public room → silently
creates one). A bot would therefore get a 404 in private rooms and gain fake memberships
in public ones, which also inflates `memberCount`.
Two separate functions, because authorization and implicit join are different jobs:
- `RoomService.authorizeActor(actor, roomId) → room`. This is **pure: no writes**. A
  human passes under today's rules (member, or any viewer of a public room). A bot passes
  only if its seating resolves to `seated` (house default or a `RoomBot` row). Otherwise
  it throws 404 (can't see the room) or 403 (a bot that isn't seated or was kicked).
- `RoomService.ensureHumanParticipation(actor, room)` **has a side effect**: today's
  implicit public-room join (upserts a `RoomMember`). It is a no-op for bot actors, by
  `actor.kind`, so a bot can never create a membership row. It replaces
  `ensureMember()`.
- Every acting path calls both, in that order: send, reply, react, place and
  delete-own. `viewable()` stays for reading. `RoomMember` stays humans-only, so
  `memberCount`, "my rooms" and membership listings are unaffected.
- The runtime checks seating before deciding (rail 2). `authorizeActor` is the backstop.

**I2. A library asset and a room occurrence are different concepts.**
- **Asset** = `BotAsset { id, botId, messageId, intents, tags, weight, cooldownSec }`.
  It points at a bot-authored `Message` (reusable content + media, uploaded once). It is
  never placed in a room by itself.
- **Occurrence** = an `Item`. Each time the bot stages something, it creates a **new
  Item** for the asset's Message. The schema already allows this: there is no unique
  `(roomId, messageId)`, and `Item` is already "a placement of a Message".
- The bot uses an internal `ItemService.placeExisting(actorId, roomId, messageId, {
  chat, parentId? })`. It authorizes through `authorizeActor()`, requires the actor to be
  the Message's author, places one Item in the transaction (numbering, `recountRooms`),
  and publishes `item.created`. It has **no idempotency skip**.
- The public `shareMessageToRooms` keeps its idempotent "skip rooms already holding a
  live Item" contract. That is a user-facing share rule, not a persistence rule, and
  the bot never uses it.
- Repeats are governed by decision policy (asset cooldown per room, recent-use
  exclusion), never by the persistence model. Tombstoning one occurrence leaves the
  asset and other occurrences intact (already true per placement).

**I3. Reply linkage never determines surface.**
- `parentId` is relationship only. `Item.chat` is surface only. They are set
  independently on every create and neither is derived from the other.
- `ReplyToItemInput` gains `chat?: boolean`, the same as `CreateItemInput`. Today it
  has no such field, and unknown fields are rejected with a 400. The new Item's `chat`
  value alone decides whether it enters chat or stage. A chat reply to a stage item
  stays in chat, and a stage reply to a chat item goes to the stage.
- `anchorStartMs` is a stage concept: rejected (400) when `chat: true`.
- Clients: stage consumers (stage queue, Play All, `advance`, thread/branch graph)
  include only `chat === false` items. `Room.tsx` `playAll`/`advance` currently walk
  `visible`, which includes chat items, so fix that. Chat consumers show `chat === true`
  items and may show a reply label, but they don't build stage branches.
- The bot's summon rule (R10) is just "set `chat` to the surface the summon came from".
  It is not special-cased.

**I4. The bot runtime consumes deduplicated room presence, never raw sockets.**
- `RoomPresence` (`services/presence.ts`) is the only consumer of SSE subscribe/close. It
  keeps per `(roomId, userId)` a connection refcount and one of three states:
  **`absent | present | leaving`** (the only presence vocabulary; the full table is in
  §4.7).
  - `presence.arrived` fires only on `absent → present`.
  - `leaving` is the grace period (default 45s, more than the SSE `retry: 3000` plus
    reconnect jitter) after the last connection closes. A reconnect inside it goes back
    to `present` silently.
  - `presence.left` fires only on `leaving → absent`, when the grace period expires.
  - Refreshes, extra tabs, reconnects and backpressure drops produce no events.
- The greeting cooldown (R9) is a second, independent guard on top of this: presence
  says "arrived"; the bot decides "worth greeting".
- `RoomPresence` also feeds the participant roster's live `present` state (§2.3). It is the
  same source for humans and bots, with bots always `present` while seated.
- It is single instance, like `StreamHub`.

**I5. Mute is per user, global (decided).** `UserMute { userId, mutedUserId }` with no
roomId. Muting chatbot, which is in every room, should not have to be repeated per
room, and muting a person typically means that person everywhere. If we need
room-scoped mute later, add a nullable `roomId` (null = everywhere) without breaking
existing rows.

**I6. Bot activity may appear in the room; human activity drives discovery.**
Product rule: bot items are real items inside the conversation, but every
discovery or freshness signal is computed from human-authored items only. That covers
lobby order, `responseCount`, `lastResponseAt`, `durationMs`, the fallback card picture,
the "opening" item and unread counts. It is one rule: **"human-authored"**, a domain predicate
with one definition and an implementation per layer (§4.6), not scattered exclusions. As a corollary, a bot never
posts into a room that has no live human item (it would turn an abandoned draft room
into a "non-empty" room).

**I7. Disclosure is data, rendered generically.** The API `User` gains `tag: string |
null`, derived on the server: `'BOT'` for bot users, otherwise null. Every place that
renders a participant name (chat row, seat label, people strip, profile/account sheet)
renders `name` plus `tag` as a small mono suffix, whatever the tag is. Participant
rendering stays identical, there's still no `isBot` branch in components, and nobody is
deceived. The API `User` also carries `kind: 'human' | 'bot'` as data for data-layer
utilities only (the human-authored predicate, §4.6). Components never branch on
`kind`; acceptance greps for that.

## 3. Functional requirements

### 3.1 Bot identity and roster

- R1. A `Bot` definition: `id`, `userId` (its real User), `handle` (`chatbot`),
  `displayName`, `avatarUrl`, `kind` (`house` | `optional`), `persona` (tone notes for
  Phase 2), `enabled`.
- R2. **chatbot** is the house bot. It is seated in every conversation by default,
  including rooms created before this feature (seating is implicit; no backfill rows).
  Seating, not membership, authorizes it (I1).
- R3. Optional bots (marketing, technical, buddy) are seated only when the owner adds
  them.
- R4. Bot users can't log in (no email/password, `isGuest=false`, `kind=bot`) and are
  excluded from auth.

### 3.2 Room membership controls

- R5. **Owner kick/add:** the room owner can remove any bot (including the house bot)
  from the room and add optional bots. Stored as `RoomBot { roomId, botId, state:
  seated | kicked, addedBy, updatedAt }`. Absence of a row means house = seated,
  optional = not seated.
- R6. A kicked bot stops all workflows in that room immediately and does not post
  again until re-added. Its past items stay, like a person who left.
- R7. **Personal mute (any user, any participant; global per I5):** `UserMute { userId,
  mutedUserId }`. Muted authors' items are hidden from your chat and skipped on your
  stage. It's generic and works for humans too, so there's no bot-only UI. The bot
  still posts for everyone else. It's **enforced on the server at every boundary**, with
  client filtering as a fallback only:
  - **Serialization:** `toItem(item, viewerId)` renders a muted author's item through
    the existing hidden/tombstone path (`toMessage(message, hidden = true)` → no text,
    no media). The graph stays intact (replies keep their parent), and the client already
    drops content-less items from chat, stage and traversal (locked behaviour). Reactions
    by muted users are left out of counts for that viewer.
  - **SSE (as built):** the stream is a per-viewer journal (each frame's item is
    serialized for that viewer), so a muted author's frame goes out in the **hidden
    shape**: no text and no media. It isn't skipped, which keeps the journal cursor
    advancing and the cache consistent. No muted content crosses the wire, and the
    client drops content-less items before they reach chat or stage. Mute sets are
    cached per viewer for 5s and invalidated on change.
  - **On mute/unmute:** the response invalidates the viewer's cached room items, so items
    already loaded are refetched in the new shape.
  - The participant roster still lists a muted person (they're still in the room). Mute
    hides what they say, not that they're present.
- R8. Private-room rules apply: a bot only acts in rooms it's seated in, and it never
  carries content from one room into another.

### 3.3 Triggers and behaviours (POC scope)

- R9. **Personalized hello.** When a new person arrives (`member.joined` or
  `presence.arrived`, both deduplicated through the greet key in §4.3), chatbot waits a
  randomized delay (for example 2–8s) and posts a chat greeting picked by weighted
  random choice from the greeting pool. It is personalized with slots like
  `{name}`, `{roomTitle}`, `{timeOfDay}`, `{returning}` and `{peopleCount}`.
  - It greets each person once per room per cooldown window (default 12h). Returning
    visitors get a different pool.
  - Burst control: if several people arrive inside the window, chatbot sends one
    combined greeting ("hey Ana and Raj").
  - Owners get no special treatment: the same arrival trigger and the same cooldown as
    everyone else.
- R9b. **Creator opening line (once per room).** On a brand-new room, chatbot posts one
  short opening line in chat. It is triggered by the room's **first live human item**,
  not by `room.created`. Home creates the room and only then posts the opening piece, so
  firing on creation would make the bot item #1 and break I6.
  - The **first live human item** decides it, exactly once per room (`BotOnce` key
    `opening:{roomId}`, §4.3):
    - Author is the owner → chatbot posts the opening line after it (`outcome: posted`).
      It counts as the owner's greeting, so it starts their greet cooldown.
    - Author is anyone else → **intended: no opening line, ever** (`outcome: skipped`,
      reason `first-item-not-owner`). The room is already a conversation, and normal
      greetings cover everyone, including the owner when they arrive.
  - "First" is evaluated once, at the moment the first human item is created. If that
    item is deleted later, the key stays decided and is never re-evaluated.
  - Rooms that already contain human items when this ships never get an opening line,
    because their first human item is in the past and the trigger only fires when it is
    created. No backfill is needed.
- R10. **Summon.** Any chat or stage item whose text contains `chatbot` (word match,
  case-insensitive, also `@chatbot`) gets a response after a short, human-ish delay.
  The response is partially guided and largely random:
  1. classify the message (see 3.4) → intent + tags,
  2. pick a response pool by intent,
  3. pick a weighted-random line or media from the pool, excluding lines used
     recently in this room.
  - It replies in the same surface it was summoned from: `replyToItem(..., { chat:
    <summon item's chat> })`. The surface comes from `chat`, never from the reply link
    (I3).
- R11. Optional bots are summoned by their own handles (`marketing`, `technical`,
  `buddy`, plus their display names). The house bot does not answer a summon meant for
  another seated bot.

### 3.4 Content: backfill and classification

- R12. **Statement library** (`BotLine`): `botId`, `text` (with slots), `intent`
  labels, `tags`, `tone`, `weight`, `cooldownSec`, `minGapSec`, `enabled`. Text lines
  create a fresh Message on every use. Media lives in `BotAsset` (I2), and a line may
  reference an asset to attach.
- R13. **Backfill** from seed files checked into the repo (`apps/server/bots/<handle>/*.yaml`)
  and loaded by a script (`pnpm --filter server bots:seed`). They are idempotent and
  editable without code changes.
- R14. **Media library:** `BotAsset` → a bot-authored Message. As built, the pack's
  `assets.yaml` lists YouTube clips by id, which are referenced and never downloaded,
  so no binaries go in the repo. The seed creates each Message + Media once. Each time the bot stages it, `placeExisting` creates a new Item
  (I2). Repeats are allowed and controlled only by cooldown/recency policy.
- R15. **Classification of incoming messages (Phase 1):** a deterministic classifier
  made of keyword/regex/rule tables in seed files. It produces `intents[]`
  (`greeting`, `question`, `help`, `praise`, `complaint`, `media-request`, `smalltalk`,
  `unknown`…) and `tags[]`, with scores. It is versioned so decisions can be replayed.
- R16. **Classification of library content:** each `BotLine` carries the intents it
  answers. Routing is `incoming intents → candidate lines → weighted pick`.

### 3.5 Decision engine (mechanics in §4)

- R17. **Weighted random with control.** A decision's inputs are: trigger, classified
  intents, room context (people count, recent bot activity, time since the last human
  post), bot persona and the line pool. Its output is either an action or nothing. Each
  decision can be tuned with `probability`, `weight`, `cooldown`, `maxPerRoomPerHour`,
  `quietHours` and so on.
- R18. **Prompt-driven conditional calls.** Workflow steps are declared as data (rule
  + condition + action), for example `when intent=question and probability 0.7 → reply
  from pool "help"; else → react ack`. In Phase 2 an action can be `call agent <name>
  with prompt <template>`. The structure stays the same; only the action implementation
  changes.
- R19. **Seeded RNG + decision log.** Each decision records `BotDecision {
  botId, roomId, workflow, runKey, trigger, packVersion, classifierVersion, inputs,
  candidates: [{ id, score, factors: { weight, intentScore, freshness } }], filtered:
  [{ id, reason }], rngSeed, draw, chosen, skippedReason, itemId, at }` (details in §4.4). We need it for
  tuning ("why did it say that") and for replaying in tests. It's capped and pruned.
- R20. **Global safety rails:** a per-room rate cap (default 6 bot posts / 10 min across
  all bots), never more than N consecutive bot items without a human in between, a kill
  switch (`BOTS=off` env), and a per-bot enable flag.

### 3.6 Workflows and timers (mechanics in §4)

- R21. A **workflow** is a named, per-bot state machine of steps that are triggered by
  events or timers, for example `greet`, `answerSummon`, `idleNudge` and
  `stageSomething`.
- R22. **Timers with jitter.** Scheduled actions use randomized delays so the bot feels
  spontaneous, for example "room idle 3–6 min with ≥1 viewer connected → 30% chance to
  post a conversation starter or stage a clip".
- R23. Timers are cancelled when their condition goes stale: the person left, the room
  emptied, the bot was kicked, or a human posted first.
- R24. Phase 1 runs timers in process (single instance, lost on restart, which is
  acceptable). Timers only fire while someone is connected, because a bot talking to an
  empty room is wasted noise.

### 3.7 Developer / tuning controls (Phase 1)

- R25. (As built: `BOTS_DEV=1`, never in production — `GET /dev/bots`, `POST
  /dev/bots/dry-run`, `POST /dev/bots/fire`, `POST /dev/bots/seat`, `GET
  /dev/bots/decisions`; see `plugins/devBots.ts`.) Dev-only endpoints or a script to: list bots, seat or kick a bot, fire a trigger
  manually (`greet <user> in <room>`), dry-run a message through the classifier and
  decision engine (shows the candidates and weights, posts nothing), and tail the
  decision log.
- R26. Time can be compressed in tests and dev (`BOT_TIME_SCALE`) so timer workflows
  can be exercised quickly.

## 4. Detailed design: the complex parts

### 4.1 Runtime pipeline

```
 domain events (events.ts)                 timers (scheduler)
 item.created · member.joined ·                    │ fire(runId, step)
 presence.arrived/left · room.seating             │
            │                                      │
            ▼                                      ▼
   ┌──────────────────┐  match   ┌─────────────────────────────────────┐
   │ TriggerMatcher   │────────▶│ RoomLane (roomId): serial queue       │
   │ per seated bot   │ start/   │   Run = workflow instance + run key   │
   └──────────────────┘ dedupe   │   steps: wait → guard → choose → act  │
                                └──────────────┬──────────────────────┘
                                                ▼ act
                         Rails (kill switch, seating, caps) ─▶ ItemService / ReactionService
                                                │                     (as bot user, I1)
                                                ▼
                                          BotDecision log
```

Rules:
- The **runtime never trusts state captured when a run started**. Every step after a
  `wait` re-reads what it needs (seating, presence, latest items). That makes
  cancellation (R23) mostly free: a stale run fails its guard and ends with a logged
  `skippedReason`. There's nothing to track and cancel.
- **Lanes serialize per room, across all bots:** at most one bot action is in flight per
  room. That means no bot double-posts, two bots can't talk over each other, and the
  room cap check plus the post can't interleave in-process. Waits don't hold the lane;
  only the guard → choose → act section runs in it. Different rooms run in parallel.
- **Cap backstop inside the write transaction:** for bot actors, the transaction's
  **first statement** is `SELECT … FROM Room … FOR UPDATE`, followed by the cap counts.
  If the cap is exceeded, it aborts with 429 `BOT_CAP` and nothing is created. The
  ordering is load-bearing. InnoDB REPEATABLE READ freezes its snapshot at the first
  consistent read, and Prisma's `create` does an INSERT then a SELECT. If any read
  happened before the lock, the counts would be stale and concurrent bots would
  overshoot. The invariant test caught exactly that in the first implementation.
  This holds across processes too (Redis / multi instance later).
- Bot-authored events are dropped at the matcher (loop guard) unless a workflow sets
  `fromBots: true` (not used in Phase 1).

### 4.2 Workflow definition (data, per bot pack)

```yaml
# apps/server/bots/chatbot/workflows.yaml
- id: greet
  on: [member.joined, presence.arrived]
  key: "greet"                       # one live greet per room; arrivals merge (§4.3)
  steps:
    - wait: { min: 2s, max: 8s, collect: 6s }   # collect = merge more arrivals (burst)
    - guard: [seated, humanPresent, notGreetedWithin: 12h, roomHasHumanItem]
    - choose: { pool: greeting, variant: "{returning ? 'returning' : 'first'}" }
    - act: { say: chat }

- id: answerSummon
  on: [item.created]
  when: { mentions: self }           # word match on handle/display name (R10/R11)
  key: "summon:{itemId}"
  steps:
    - wait: { min: 1.5s, max: 4s }
    - guard: [seated, itemLive]
    - choose: { by: intents, fallback: smalltalk }
    - act: { reply: sameSurface }    # chat = the summon item's chat (I3)

- id: idleNudge                      # Phase 1b
  on: [room.idle]                    # synthetic: no human item for N min while present
  key: "idle"
  steps:
    - guard: [seated, humanPresent, probability: 0.3]
    - choose: { oneOf: [{ pool: starter, weight: 3 }, { asset: clip, weight: 1 }] }
    - act: { say: chat, stage: asset }
```

- **Step types:** `wait` (jittered delay, optional `collect` window), `guard` (named
  predicates; any failure ends the run with that reason), `choose` (the weighted pick in
  §4.4; it may pick "nothing"), `act` (`say`, `reply`, `stage`, `react`; Phase 2 adds
  `agent`), plus `branch` (`if`/`else` on guards or probability) for conditional chains
  (R18).
- Guards and actions are a fixed, typed registry in code. Packs only compose them, so
  YAML can't express arbitrary logic. Packs are validated at seed or boot time, and an
  invalid pack fails loudly.

### 4.3 Run keys, dedupe and bursts

- `key` is unique per (bot, room). A trigger whose key already has a live run doesn't
  start a second one. With `collect`, it is merged into the live run instead (burst
  greeting: the arrivals collected during the window → one "hey Ana and Raj"). For that
  reason greet uses a room-wide key (`greet`). Per-person dedupe comes from the subject
  set plus the cooldown guard.
- Cooldown is not part of the key. It's a guard (`notGreetedWithin`) backed by the
  decision log, so it survives the run and is visible in dry runs.
- **Once-ever keys** (`opening:{roomId}`) are persisted, never in memory only:
  `BotOnce { botId, roomId, key, outcome: posted | skipped, itemId?, at }`, unique on
  `(botId, roomId, key)`.
  1. The trigger matcher checks `BotOnce` **before scheduling** a run. If a row exists,
     no run starts.
  2. At act time, the run **claims** the key by inserting the row (`outcome: posted`)
     inside the same transaction that places the Item. A unique-constraint conflict
     means another run or instance won, so it skips. If the post fails, the
     transaction rolls back and the key stays unclaimed, so the run can be retried.
  3. Deliberately ending a once-ever run without posting (for example R9b's
     not-the-owner case) writes `outcome: skipped`, which is just as final.
  This survives restarts and is race-safe without relying on the decision log.
- **Cooldowns** (greet 12h, freshness 24h) read `BotDecision`, which is persisted.
  Pruning keeps at least the longest cooldown/freshness window (default retention 7
  days), so pruning can never reset a cooldown.

### 4.4 Choosing (weighted random, reproducible)

1. **Candidates:** pool entries (`BotLine` / `BotAsset`) of this bot that are
   `enabled`, match the requested pool/intents and whose slots can all be filled.
2. **Filter:** drop entries on cooldown in this room (`cooldownSec`), entries among the
   last K used in this room (default K=5) and entries whose `minGapSec` since any bot
   post hasn't passed.
3. **Score:** `weight × intentScore × freshness`, where `intentScore` comes from the
   classifier (1 for non-intent pools) and `freshness` decays an entry's score by how
   often it was used in this room in the last 24h.
4. **Pick:** a weighted draw using an RNG seeded with
   `hash(botId, roomId, triggerEventId, stepIndex, packVersion)`. The same inputs give
   the same choice **given the same scored candidates**. An empty candidate set means
   the run ends `skippedReason: no-candidates` (it never falls back to "say anything").
6. **Replay is snapshot-based.** Freshness and cooldowns depend on usage history, so
   seed + inputs alone can't reproduce a past choice once the room has moved on. The log
   therefore stores the scored candidate list (ids, scores, factors), the filtered
   entries with reasons, the seed and the draw value. There are two modes:
   - **Exact replay** re-runs the draw over the logged candidates. It always reproduces
     `chosen` and is used to audit "why did it say that".
   - **Re-derive** recomputes candidates from current state with the logged seed and
     diffs them against the snapshot. It is used to see what a pack or tuning change
     would have done.
5. Fill slots (`{name}`, `{roomTitle}`, `{timeOfDay}`, `{peopleCount}`…) from data
   re-read at act time.

### 4.5 Rails (checked in this order at every `act`)

1. `BOTS=off` / bot disabled → skip.
2. Seating (I1): kicked or not seated → skip. The service-level `authorizeActor()` is the
   backstop.
3. I6 corollary: the room has no live human item → skip.
4. Room cap: ≤ 6 bot posts / 10 min across all bots, and ≤ 3 consecutive bot items
   without a human item between them. It's checked here (cheap, in the room lane) and
   again in the write transaction (authoritative, §4.1).
5. Act → `BotDecision` records chosen entry, seed, inputs and resulting itemId.

Every skip is logged with its reason. "Why didn't it answer?" is always answerable.

### 4.6 Human-activity rule (I6): where it lands in code

The invariant is **"human-authored"**: the item's Message author has `kind = 'human'`.
It's defined once in `packages/shared/src/authorship.ts`, with one face per layer, and
each face is tested against the same fixtures:

- `isHumanAuthored(item)` works on DTOs and in memory (server services, client data
  utils). It reads `item.author.kind`.
- `humanAuthoredWhere` is the Prisma `ItemWhereInput` fragment (server).
- `humanAuthoredSql(alias)` is a raw-SQL fragment for `$queryRaw` seams (server).

**Parity tests (required, Phase 1a gate).** If the three faces diverge, the lobby and
unread disagree in ways that are very hard to diagnose, so one shared fixture set
(human items, bot items, a bot reply to a human, a human reply to a bot, tombstoned items
of each, shared placements, a bot-authored library Message placed by `placeExisting`)
is run through all three:
- `isHumanAuthored` over the serialized DTOs,
- `db.item.findMany({ where: humanAuthoredWhere })`,
- `$queryRaw` with `humanAuthoredSql`.

They must return the **same item-id set**. Seam-level checks also run on the same
fixtures: `recountRooms` numbers equal the in-memory count from `isHumanAuthored`, and
the server's last-human-item number equals the one the client's catch-up computes. Any
new seam must add itself to this test.

That is why the API `User` carries `kind` (I7): data utilities need it. Components
still render only `tag`. Seams:

| Seam | Today | Change |
|---|---|---|
| `ItemService.place()` | bumps `Room.lastActivityAt` (lobby sort key) on every item | bump only when the author is human |
| `recountRooms()` | counts all live items; `responseCount = items − 1` | count human items only; "opening" = first human item; `lastResponseAt`/`durationMs` from human items |
| `fallbackPictures()` | earliest live picture of any author | earliest human-authored picture (a bot clip never becomes the card image) |
| unread / catch-up (`readCursor.ts`, client) | numbers of all items | `isHumanAuthored`: bot items never make a room unread, but catch-up passes over them |
| `newConversation` abandon | room "empty" if opening never posted | unchanged, because the bot never posts before the first human item (rail 3) |

`rooms:recount` must be re-run after deploy so existing rooms pick up the rule.

### 4.7 Presence state machine (I4)

Per (roomId, userId): `connections` (refcount), `state`, `awayTimer`.

| State | Event | Action → next state |
|---|---|---|
| `absent` | connect | connections=1 → `present`; emit **`presence.arrived`** |
| `present` | connect | connections++ (extra tab), no emit |
| `present` | disconnect, connections > 1 | connections--, no emit |
| `present` | disconnect, last one | connections=0, start `awayTimer` (45s) → `leaving` |
| `leaving` | connect (refresh/reconnect within grace) | cancel timer, connections=1 → `present`; **no emit** |
| `leaving` | `awayTimer` fires | → `absent`; emit **`presence.left`** |

- Bots are not in this machine. Seated bots are reported `present` by the roster directly.
- `room.idle` (for `idleNudge`) is derived here too: at least one human `present`, and no
  human item for N minutes. One timer per room, re-armed on each human item.
- Single process; state is lost on restart. After a restart everyone reconnects as
  `arrived`, and the greet cooldown guard (from the decision log, which persists)
  prevents a wave of re-greetings.

### 4.8 Phase 2 seam

The `choose` and `act` step types are where AI plugs in. Nothing else changes:
- The **intent router** becomes a `choose` provider: the deterministic classifier runs
  first, and the router is called only when the rails and a `branch` allow it (budget,
  probability, confidence below a threshold).
- An **agent call** is an `act` (`agent: technical, prompt: <template>`) with a timeout,
  falling back to a library `choose`. Its output goes through the same rails and the same
  `ItemService` path, and is logged in the same `BotDecision`.

### 4.9 AI policy — observational only (binding, 2026-10-04)

> **Until the agent action model and the permission system are designed, OpenAI is
> observational only. It may classify and recommend, but it cannot create
> user-visible content or mutate workspace state.**

Concretely:
- **Router only.** No AI-written replies and no AI-chosen actions. A router answer is
  logged (`BotRoute`) and nothing acts on it.
- **Explicit bot mentions are deterministic and never call the model.**
- **Only sampled, unmentioned human messages** (`item.created` by a person) in a room
  where someone is present may be routed, in shadow.
- **No tool/function calls**, no CRM/task/project mutations, no sending of messages or
  emails, no record edits.
- **No autonomous timers trigger AI calls** (idle nudges, greetings and openings stay
  deterministic). No AI calls from tests, background jobs or empty rooms.
- **Hard caps stay on:** per-room (`AI_ROUTER_ROOM_MAX`/10 min), per-day calls
  (`AI_ROUTER_DAILY_MAX`), per-day spend (`AI_ROUTER_DAILY_USD`, estimated), timeout
  (`AI_ROUTER_TIMEOUT_MS`), and kill switches (`AI_ROUTER` unset/off, and `BOTS=off`).
- **Every AI request logs** trigger, room, input size, model, latency, result, error,
  token usage and estimated cost.
- **AI stays optional:** with `AI_ROUTER` off the product is fully functional. There is
  no "live" mode value; anything but `shadow` means off.

How it is enforced in code, so that it can't erode:
- `routerConfig()` is off under `NODE_ENV=test`, with `BOTS=off`, or without
  `AI_ROUTER=shadow` + key + model. vitest also pins `AI_ROUTER=off` and an empty key.
- `shadowRoute()` returns early on any mention, an empty room, an unsampled message or
  any cap.
- Static architecture tests (`ai-router.test.ts`) check that:
  - the AI module (`bots/ai/*`) imports nothing that can post, react, seat, mute or
    publish;
  - it writes only `BotRoute`;
  - only the shadow recorder uses the router;
  - only the runtime calls the recorder.

**Slice 2 (AI-written replies) is blocked by this policy**, not just by the shadow
stats, until the agent action model and permission system exist.

## 5. Phasing

### Phase 1a — Plumbing + POC (target: today)
1. Commit the `Item.chat` work (dependency).
2. `User.kind`, `Bot`, `RoomBot`, `BotLine`, `BotAsset`, `BotDecision`, `BotOnce`,
   `UserMute` schema; seed chatbot's user, lines and assets.
3. Invariant plumbing: `authorizeActor()` + `ensureHumanParticipation()` on every
   acting path (I1);
   `placeExisting` (I2); `chat` on `ReplyToItemInput` + stage consumers filter `chat`
   (I3); `RoomPresence` (I4); the human-authored predicate (all three faces) at every discovery seam +
   `rooms:recount`
   (I6, §4.6); `User.tag` + generic name suffix (I7).
4. `services/events.ts` emitter. Emit from `publishCreated`, `join` and `RoomPresence`.
5. `BotRuntime`: subscribe → classify → decide → act via `ItemService` as the bot user.
6. Participants in the room payload, and `roomPeopleFrom` merges them, so chatbot holds
   a seat before speaking.
7. POC behaviours: **personalized hello on join**, **summon response** and **creator
   opening line** (R9b).
8. Tests: server tests drive events and assert items (seeded RNG), the
   human-authored parity suite (§4.6), plus invariant tests:
   a bot posts in a private room without a membership row, `memberCount` is unchanged, a
   kicked bot is refused, an asset is staged twice in one room → 2 Items, a chat reply to a
   stage item stays out of the stage queue, and 3 tabs + a refresh → one `arrived`. A
   browser check that the bot renders as a normal person (no bot-specific DOM).

**Gate:** all Phase 1a invariant and parity tests pass, with the full server suite
green, before any Phase 1b work starts.

### Phase 1b — Roster + controls
- Owner add/kick (`PUT/DELETE /rooms/{id}/bots/{botId}`), personal mute
  (`PUT/DELETE /users/me/mutes/{userId}`) and client filtering of muted authors.
- marketing / technical / buddy chatbot: separate seed packs, handles and personas.
- Idle and spontaneous timer workflows, stage media from the library, and reactions.
- Dev tuning tools (R25–R26).

### Phase 2 — Real AI (OpenAI)

**Agreed shape (2026-10-04):** the AI router is *not* the new authority over every
message. The pipeline stays:

`deterministic prefilter → maybe AI router → chosen bot → maybe agent call → existing rails → ItemService`

Phase 1 control and safety behaviour is preserved, and cost stays bounded. **The
deterministic system must still run the product with AI fully disabled**, which makes it
the fallback, the test oracle and the baseline for judging whether AI actually improves
the interaction. Media stays on the YouTube asset library. There's no generated media
until routing and text are stable.

Slices, each gated on the previous one's logs:
1. **Router only, in shadow mode.** Input: message + compact room context + seated
   bots. Output: `{ agent, intent, confidence, shouldRespond }`. It generates no reply
   and changes no behaviour. Each call is logged next to the deterministic routing
   (`BotRoute`, agree/disagree) so the two can be compared. A deterministic prefilter
   decides whether to call at all (mentioned → always; otherwise sampled), with
   per-room and per-day caps, a timeout, and AI off by default.
2. **One AI agent (chatbot).** *Blocked by §4.9 until the agent action model and
   permission system are designed.* It would generate text only, through the same
   workflow, rails and posting path. A timeout or error falls back to the deterministic
   line.
3. **Optional bots** (marketing / technical / buddy) with distinct context. Only after
   that: richer context windows, tools, TTS, image/media generation.

**Shadow findings (gpt-4.1-mini, 2026-10-04 smoke test):** explicit summons and
human-to-human talk already agree with deterministic routing. The router adds value on
**unmentioned specialist requests** ("why does my upload fail with a 413?" → technical;
"rough day" → buddy). Latency: 1.3–1.9s warm, ~5.3s cold.

**Target live architecture (slice 2 design):**
- explicit summon → **deterministic routing** (no model call);
- ambiguous / unmentioned request (deterministic prefilter: question / help / task /
  complaint intent, no bot named) → **AI router**;
- router timeout or error → **deterministic fallback**;
- a live budget of ~1.5–2.5s, defined separately when (and if) a live path is
  permitted; the shadow timeout (5s) must never become it by inertia.

**Shadow measurement before going live** (`/dev/bots/routes/stats`; label rows with
`POST /dev/bots/routes/:id/label`): disagreement rate on unmentioned messages, handoff
precision against labels, none false positives / negatives (router vs labels, with the
deterministic baseline on the same rows), and warm p50/p95 (cold calls are flagged and
excluded). Unmentioned messages are routed by default. Mentions are never routed
(§4.9). The deterministic agreement baseline comes from the labeled rows instead.

**Intent taxonomy:** `task` (produce or do something: write, draft, give me) was added to
the router and to every pack's classifier (c2), so generic requests no longer fall into
`media-request`.

Original notes:
- **Intent router call**: one cheap OpenAI request receives the message, short room
  context and the roster of seated agents with their distinct context and personas. It
  returns `{ agent, intent, confidence, shouldRespond }`. The deterministic classifier
  stays as the fallback and as a pre-filter that decides whether the router call
  happens at all.
- **Agent calls** are scripted into workflows as actions (R18): each agent has its own
  system context, tools and budget. The workflow chooses between a library line and a
  generated answer.
- **Media generation** (images, voice/TTS clips to stage) is uploaded as bot-owned
  Media and posted through the same paths.
- Guardrails: per-room and per-day token/cost budget, timeouts falling back to library
  lines, moderation pass, and logging prompts and responses in the decision log
  (redacted).
- Bot "voice": TTS audio items so the bot can be present on the voice-first stage
  rather than only in text.

**When do we need actual AI?** Only for open-ended answers, conversation awareness
beyond keywords, and generated media. Greetings, summons, timers, stage content,
mute/kick and the whole decision and control layer are Phase 1 and must work without
it.

## 6. Out of scope (this epic)

- Multi-instance runtime (Redis pub/sub, distributed timers).
- Bots in DMs or notifications, bot-to-bot conversations, and user-authored bots.
- Any bot-specific UI beyond the generic `tag` suffix (I7).

## 7. Open questions

Resolved: disclosure → I7 (`BOT` tag); lobby stats → I6; greeting trigger → both,
deduped by greet key + cooldown (§4.3); library repeat → I2; owner/creator → R9b (opening
once; owners otherwise like everyone); read cursor → bot items never make a room unread
(§4.6); mute scope → global (I5).

Still open (none block the build):
1. **Mute surface:** chat only, stage only, or both? The default is both.
2. **Pack format:** YAML in the repo (default) vs. a DB-editable admin later.
3. **Seat placement:** does the house bot always take a fixed seat, or join the normal
   seat order?

## 8. Acceptance (POC)

- A new guest opens a public conversation. Within ~2–8s chatbot greets them by name in
  chat, and chatbot is seated before it speaks.
- Typing "hey chatbot what's up" in chat gets a varied reply. The same message 5×
  doesn't repeat the same line back to back.
- Chatbot's rows, seat and avatar are rendered by the same components and the same DOM
  structure as a human's. A grep for bot conditionals in `apps/web/src/features/room`
  finds none.
- With `BOTS=off`, nothing from the bot is posted. The decision log explains every post
  and every skipped decision.
- Creating a conversation from Home: the human's opening piece is item #1, chatbot's
  opening line follows once, and reloading or re-entering never produces a second one.
- Bot posts in a room change neither its lobby position nor `responseCount`,
  `lastResponseAt` or the card picture (I6).
- Chatbot shows a `BOT` suffix wherever names render, through the same generic `tag`
  path (I7).
- Opening line survives restart: restart the server right after it posts, re-enter the
  room, and there's still exactly one (`BotOnce` row present). If someone other than the
  owner posts first, there's no opening line and `BotOnce.outcome = skipped`.
- Two bots in one room under load never exceed the room cap: a forced concurrent test
  gets `BOT_CAP` from the transaction, not an extra item.
- A viewer who muted chatbot receives no SSE frames for its posts, and `GET` on its items
  returns content-less items. Other viewers see them normally.
- Exact replay of any logged decision reproduces `chosen` after the room's usage history
  has changed.
