# Project State — Voice Chat

## MVP

**What it does:** People join public or private rooms and hold branching, voice-first conversations (text, audio, video, files) where any item can be replied to and branches are derived from `parentId`.

**Users:** single role. Guests participate immediately; any guest can upgrade to an email/password account in place. Room owners manage their room and its invite code.

**In V1:**
- Guest-first sessions + register (upgrade) / login / logout
- Rooms: create, browse public (search + topic filter), my rooms, join, leave, public/private
- Private rooms via rotatable invite code (`/room/:id?invite=CODE`)
- Items: post text/media, reply (`parentId`), tombstone delete (author only)
- Media upload (local disk in dev, S3-compatible Railway bucket in prod)
- Reactions: one per user per type (like/ack/laugh), toggleable
- Live room updates via SSE (`item.created`, `item.updated`)

**Parking lot (V2+):** notifications, unread counts / lastRead, mentions, multi-topic tags, in-room search, Redis pub/sub for multi-instance SSE, orphaned-media sweep, admin panel, newest-first item windowing.

## Stack

Defaults (pnpm monorepo, Fastify + fastify-openapi-glue, Prisma + MySQL, OpenAPI 3.1 → openapi-typescript → openapi-fetch SDK), with the deviations below.

## Deviations from Defaults

- **Frontend kept as-is.** `apps/web` is the pre-existing Vite/React app with its own CSS-token design system (industrial retro-modernist). **Skip Phase 3 template steps** that would overwrite it: no Tailwind, no `pages:generate`, no Shell/UI primitive templates, no templated `main.tsx`. The `pages:generate` script is intentionally not in root `package.json`. Frontend conventions live in `doc/03-*.md`.
- **Guest-first auth.** `User.email`/`passwordHash` nullable, `isGuest` flag. `POST /auth/guest` added; `POST /auth/register` upgrades the current guest session when present. No `username`.
- **User is flat in the API** (`displayName`, `avatarUrl` on `User`), though DB keeps the User/Profile split.
- **Lowercase enum values** in Prisma and API (`audio`, `like`, `public`) to match existing frontend types.
- **API `Media.type`** (DB column `kind`); `Media.poster` (DB `posterUrl`).
- **`POST /media`** (not the plugin's `/media/upload`), multipart. Handler must use `request.parts()` — the frontend appends `file` before other fields.
- **No `/api` prefix** — frontend `VITE_API_URL` must point at the server root.
- **Nullable fields use OpenAPI 3.1 type arrays** (`[string, 'null']`), not `nullable: true`.
- `redocly.yaml` disables `no-server-example.com` and `no-unused-components` (StreamEvent is SDK-only typing for SSE).

## Locked Behaviors (capture/playback)

Invariants agreed after the 2026-10-01 stabilization pass. Change only deliberately.

- **`crossOrigin="anonymous"` is mandatory** on server audio routed through the Web Audio graph (Media's StereoPanner). Without it Chrome outputs zeroes for cross-origin media. Server must keep sending ACAO on `/uploads`.
- **One audio graph per media element, one shared AudioContext** (`graphs` WeakMap + `audioContext()` in `components/Media.tsx`) — StrictMode-safe (reuse on remount; deferred disconnect on real unmount). The shared context is never closed: a context per element accumulated one per clip played, and iOS caps them. Never call `createMediaElementSource` or `new AudioContext` for playback directly.
- **Capture failures always return to idle** and restore interrupted playback (`resume()` in Instrument), then show a human error. Stop is ignored until the recorder is actually recording.
- **The camera is held only while framing or recording** (2026-10-03): `CameraPreview` opens a framing stream it alone owns while the record surface is in camera mode, and stops it on unmount (Stop → playback, Save, close, mic mode) and when recording starts; during a take it shows the recorder's stream. Never share/overwrite a preview stream reference (that leak kept the light on). Permission persists, so reopening needs no prompt.
- **Upload failure keeps the local recording** (blob retained; Send retries).
- **Text/image/file items explicitly participate in playback completion** (Item dwell → `onEnded`). Timing (`DWELL` in `components/Item.tsx`): min 2.0s, 60ms/char, cap 7.5s; image/file without text 2.75s. Interaction holds the dwell — mouse hover, focus within, or touch tap toggle (shows HELD) — and resuming continues the remaining time.
- **Drag-to-cancel suppresses the click that follows the drag** (`draggedRef`, reset on pointerdown).
- **The reply tether is purely visual** (`components/Anchors.tsx`) and must never drive graph/reply logic.
- **Dwell hover-hold needs real pointer movement** (`movementX/Y ≠ 0`). Follow-scrolling puts the active item under a resting cursor and the browser fires zero-movement synthetic events; those must not freeze playback.
- **Follow = one reveal per newly active item** (`Feed.tsx`, `utils/reveal.ts`): `scrollIntoView` on both axes (desktop timeline scrolls inside `.feed`, mobile scrolls the window), plus one settle re-reveal after a branch expands.
- **Detach** on any user scroll gesture (wheel, touchmove, scroll keys) halts in-flight follow-scroll so the user wins immediately; playback continues. **Re-attach** automatically when the playing item's centre is back inside the *visible* area (viewport ∩ timeline clip), or via the return control (arrow points at the playhead). Explicit play re-attaches.
- **Traversal skips** tombstoned (content-less) items; a placement deleted while active advances at once; media that can't play (`play()` rejects with anything but NotAllowed/Abort, or a load error) counts as ended. **Blocked autoplay** (NotAllowedError) keeps the item active with "TAP TO CONTINUE"; tapping the paused active item resumes it in place.
- **End of traversal** holds 1.5s; an item arriving in that window is played; the hold only goes idle if playback is still on that same item.
- Threads auto-expand by **thread root** (deep replies must mount or their audio never ends).

## Room visual system (2026-10-01)

- **One structural grid** (`styles/globals.css` `:root`): `--edge` (header's left edge), `--seq-col`/`--seq-gap` (numeral column → text), `--col-w` 420px / `--col-gap` 4.5vw (desktop columns), `--instrument-clear` (space kept free for the Instrument). Header, timeline start, numerals, reply toggles and branches all hang off these.
- **Desktop timeline** starts on the header edge, bleeds to the window and fades in the side margins (mask), snaps columns to that edge — prev/current/next visible together.
- **Time axis**: one 1px low-contrast hairline per column at the numeral baseline (= meta-row bottom, measured 24px); the playing column's segment turns signal. No ticks/arrows/chrome.
- **Instrument mass by state** (`data-mass` on the record button): rest = thin ring (opaque centre), present (playback) = firmer ring, dense = filled (recording); review/compose take over. Secondary controls are one evenly spaced mono set; camera flip lives only in video review (applies to Retake).
- **Floor**: `.instrument-floor` — solid behind the Instrument stack, soft top edge (`--floor-fade`); content passes under it. Footer sits above it.
- **Reply**: labels show `RE:007`, never ids. Background reaction is ~25% of the old swing. Tether (`ReplyTether` in `components/Anchors.tsx`) = plumb line from the target numeral's glyph down its gutter to below the thread, then one bend into the Instrument's label; purely visual, re-measured per frame.
- **Reaction row**: on hover devices takes no space until hover/focus; always shown (dim) on touch.

## Message / Item model

- **Message** = reusable content: `id, author, text, media`. **Item** = its placement in one room: `id, roomId, messageId, number, parentId, reactions, message` (message always hydrated). Media attaches to the Message (`Media.messageId`), once.
- Operations:
  - `sendMessage` `POST /rooms/{roomId}/items` → new Message + first (top-level) Item.
  - `replyToItem` `POST /items/{itemId}/replies` → new Message + child Item; **room always taken from the parent** (a reply can't jump rooms).
  - `shareMessageToRooms` `POST /messages/{messageId}/share` `{ roomIds }` → new top-level Items only; reuses Message + media (no duplicate rows/uploads). Returns `{ data: Item[] }` of newly created Items; rooms already holding a live Item are skipped (idempotent). All-or-nothing.
- Decisions made while completing the contract (change deliberately):
  - **Only the author may share** (403); non-viewers of the message get 404 — prevents re-publishing private-room content.
  - **Unknown request-body fields are rejected (400)** — Fastify ajv `removeAdditional: false` in `app.ts`. Stale clients sending `parentId` to sendMessage fail loudly instead of silently posting top-level.
  - Deleting an Item tombstones that placement only (content hidden in that room); other shared placements stay visible. Reactions are per Item.
- SDK hooks: `useSendMessage(roomId)`, `useReplyToItem(roomId)` (`{ itemId, text?, mediaIds? }`), `useShareMessage()` (`{ messageId, roomIds }` → created Items upserted into each room's cache). Web: `api/adapt.ts` flattens `item.message.*` for the existing UI; `Room.send` routes to reply when the UI shows "RE: …".
- Dev DB migrated in place (backfill: one Message per pre-existing Item, same id; media relinked). Pre-migration dump: scratchpad `voice_chat_dev-before-message-split.sql`. Test DB reset.

## Anchored replies (V1, 2026-10-01) — spec: `doc/05-anchored-replies-spec.md`

- `replyToItem` accepts optional `anchorStartMs` (`ReplyToItemInput`); `Item.anchorStartMs: number | null`. `sendMessage` rejects it. Stored on the room Item (share copies none).
- Server rule (`ItemService.anchor`): parent placement not deleted, exactly **one** audio/video attachment, known (client-reported) duration → else 400 `ANCHOR_UNSUPPORTED`; `anchorStartMs ≤ round(duration·1000)` → else 400 `INVALID_ANCHOR`. Checked before the transaction (rejections create nothing).
- An anchor is a **moment** (point), not a segment. Captured at **REPLY HERE** (from the playing element's `currentTime`), held in `ui.replyAnchorMs` through compose/record/review, sent at Send unchanged. Label `RE:014 · 01:52`.
- UI: `utils/anchor.ts` mirrors the server rule (REPLY HERE only where it would be accepted); `AnchorRail` draws points on a hairline under the media, clusters within ~6px (visual only), signal when a cluster holds the playhead; tapping a marker expands the thread and marks those replies (`[data-anchor-focus]`). Anchored replies show `AT 01:52`.
- Playback order ignores anchors. No "play with replies" weaving.
- Tests: server 106/106 (10 anchor cases); browser `anchors` suite 17/17 (success criterion end to end, desktop + mobile).

## YouTube media source (2026-10-01) — spec: `doc/06-youtube-media-spec.md`

- Same playable parent as captured/uploaded video; anchored replies work identically. Never downloaded: `Media` row with `source: youtube`, `externalId` (canonical id), `title` (oEmbed), `embeddable`, client-measured `duration`; URL/poster derived from the id.
- `POST /media/youtube` (`createYouTubeMedia`): shared parser (`packages/shared/src/youtube.ts`) → `INVALID_YOUTUBE_URL`; oEmbed lookup (`YouTubeService`, swappable via `setYouTubeLookup` in tests) → `YOUTUBE_UNAVAILABLE` / not-embeddable / 502 `YOUTUBE_LOOKUP_FAILED`. Not embeddable → duration null → anchors refused by the existing rule.
- Playback contract: `media/controller.ts` (`PlayableMediaController` + registry). Native `<audio>/<video>` and YouTube (`media/youtube/*`) register controllers; REPLY HERE reads `controllerWithin(item).getCurrentTimeMs()`.
- `Media` routes a YouTube URL to `YouTubeMedia` (facade until active/upcoming/tapped, then a sticky player; our own timeline + seek + `AnchorRail` beneath the embed; link card + OPEN ON YOUTUBE when not playable). 
- Composer: a pasted YouTube link → `YouTubePreview` (duration/title/embeddability) → Send posts a `YouTubeDraft`; `api/sendMedia.ts` `resolveMediaIds` resolves drafts/uploads for both Room and Home.
- Client `anchorableMedia` mirrors the server: exactly one audio/video attachment, embeddable, known duration.
- Browser suites (scratchpad `iso/`): `youtube.cjs` (simulated IFrame API via route interception), `youtube-real.cjs` (real YouTube).
- **Locked (2026-10-01):** YouTube playback stays behind the shared media controller permanently; our reply/activity timeline stays *under* the embed and never modifies or competes with YouTube's native controls; non-embeddable videos stay link cards with no anchored replies; browser-reported duration stays for the POC; Home and Room keep the shared send helper (`resolveMediaIds`); "players stay loaded" is left alone until real usage shows it matters. YouTube plumbing is frozen.

## Lobby = conversation cards (2026-10-02)

The in-lobby River (playing posts and replies inline) was retired: the Lobby only lists conversations; watching, media and replies happen inside the conversation. River code is gone (last state: tag `archive/river-explorer`, branch `feat/lobby-cards` = reference only, never merge).

- **Name, description and thumbnail are all optional** (changed 2026-10-03; previously required). `CreateRoomInput` has no required fields; blank title/description are stored as `''`, and an update may blank them. A thumbnail, if given, must still be the caller's own image or a YouTube video they added (`RoomService.ownImage`) → else 400 `INVALID_THUMBNAIL`. A blank name displays as `Conversation 007` (`utils/room.ts roomTitle`).
- **Created from Home's record surface** ("New conversation", `views/Home.tsx`): the identity header (`RecordSurface` `IdentityField`) offers name, description and picture; Save never refuses for missing ones. Picture suggestion: a captured video's still (`utils/thumbnail.ts videoFrame`, seeks by capture length, skips dark frames), else an image/YouTube attachment (reused, not re-uploaded). `features/conversation/newConversation.ts`: per-draft `Progress` makes a retry reuse the room/uploads (no duplicate rooms); a new take or picture discards stale uploads; closing the draft deletes unused uploads (`DELETE /media/{id}`) and any empty room made for it. HEIC/unsupported images refused up front.
- **Room stats** (`responseCount` = live items after the opening one, `durationMs` = live audio/video time, `lastResponseAt`) are recomputed by `recountRooms()` (`services/roomStats.ts`) inside every place/share/delete transaction — never incremented. Backfill: `pnpm --filter server rooms:recount` (run on local dev 2026-10-02; **run on Railway once**).
- **Cards** (`features/lobby/ConversationCard.tsx`, `lobby.css`): thumbnail, name, 2-line description, meta `1 RESPONSE · 01:05 · STARTED OCT 2 · LAST 2H AGO · PRIVATE`, owner Delete. A room without a thumbnail gets its earliest live picture from the server (`fallbackPictures` in RoomService); none → the room number.
- `replyFromUIState` stays on Home: in the SPA a reply started in a room can still be in progress when you reach Home.
- Browser suite `iso/create.cjs` (scratchpad, pair :3002/:5174, TEST DB): 12/12 ×2.

## Video soundtrack = preview layers, Save remuxes (2026-10-03)

- **Preview renders nothing**: `EditPreview` → `VideoPreview` / `useLayeredPlayback` plays the take as-is (voice audible) as the only clock; the stock track loops under it via the shared preview AudioContext at `MUSIC_GAIN` (`edit/soundtrack.ts`), cued to `video.currentTime` on play/seek and re-cued past 80ms drift. Cancel is free.
- **Save remuxes once** (`edit/remuxSoundtrack.ts`, mediabunny, lazy-loaded): video packets copied unchanged (bit-exact; WebM for vp8/vp9/av1, else MP4), voice + looped music mixed once in `OfflineAudioContext`, encoded as the only audio track, length = the video's own (writes a real duration, fixing Firefox's duration-less webm). ~0.1–0.3s instead of real-time canvas re-encode.
- `composeClip` (canvas + MediaRecorder) remains only for a **still image + audio**, which has no video stream to copy. Never route video through it again.

## Virtual background (2026-10-03) — spec: `doc/07-virtual-background-plan.md`

- Chosen while framing (strip under the camera: ORIGINAL · BLUR · photos · +); baked in while recording, never re-rendered after. Pipeline (`features/vbg/`): mask source → stabilizer → compositor (`features/virtualCamera.ts`). Sources: **MODNet on WebGPU** (production default, Apache-2.0, `public/models/modnet.onnx` + ORT at `/ort/`) → **MediaPipe** fallback; **RVM is evaluation-only (GPL-3.0)**: dev-build branch only, weights in gitignored `apps/web/.dev-models/`, never in `dist/` — keep it that way. `state/background.ts` (own photo in IndexedDB).
- The compositor never opens/stops the camera: `CameraPreview` (framing) and `useMediaCapture` (recording: canvas video + mic) own it. Preview canvas is separate from the recording canvas so a mirrored front camera keeps the photo readable while the recording stays unmirrored.
- Record is disabled until the segmenter is ready (ORIGINAL escape hatch). Masks older than 500 ms → raw camera.
- **Quality-first order (locked 2026-10-04):** clean subject extraction → full-rate segmentation (temporal responsiveness) → artifact-free background → best *sustainable* output resolution → generous bitrate → upload size last. Never trade segmentation cadence for 1080p. Budget ladder (`virtualCamera.ts`): polish → half-size blur → canvas ≤1280 → every 2nd frame → Original, with trial climb-back. Bitrate follows the recorded output: 8 Mbps at 720p, 12 Mbps at 1080p. Judge quality from a saved recording, not the scaled preview.

## Workspace foundation (2026-10-05) — spec: `doc/09-workspace-foundation-proposal.md`

- Business data (Inbox, Calendar, Contacts, Sales, Tasks) belongs to a **Workspace**, never a Room; conversations only link. First-class tables, no EAV. Decisions D1–D15 in doc/09 §11; slices 0→4 in §10.
- **Attention (doc/11, revised 2026-10-06):** business event → one workspace `ActivityEvent` → optional line in the shared workspace channel (`workspace-activity`). Curated (new contact, follow-up, workflow done). Inbox desk and per-member `InboxItem` fan-out are deferred; `InboxItem` stays for a future true inbound queue. `Compose` is the shared follow-up. D3 revised.
- **Slice 0 built** (§12): Workspace/Member/Invite/Team/TeamMember, ActionExecution (audit + idempotency), Activity/ActivitySubject (timeline). Membership = registered humans only; bots never (no `agent` actor — doc/08 §4.9).
- **Permissions only in `services/workspacePolicy.ts`** (`authorize` → 404 to non-members). **Every workspace mutation goes through `runAction`** (`services/actions.ts`) in its transaction. Load related rows with `workspaceId` in the where-clause; add each new FK pair to `services/workspaceIntegrity.ts`.
- Owners/assignees reference `WorkspaceMember.id` (rows never deleted; `removed`). A workspace always keeps an active owner (`LAST_OWNER`).
- Rooms have no `workspaceId` (D5).
- **Slice 1 built** (§13): Contacts/Accounts/Tags, the one matcher (`services/contactMatch.ts` — email/domain are signals, never unique keys), Notes (body = a Message; shareable into rooms), RecordLink (record ↔ note/conversation), merge, timelines. Import deferred to the next slice.
- Timelines: linking adds the record to the object's activities; rooms the viewer can't see are redacted (`records.ts redactRooms`).
- **Documents backend seam** (doc/10 §14): registry/descriptor union, grants, relations, room links, Google links (`externalFileId`), Contacts dataset (keyset query, export, review copy, versioned writeback). **Import has two paths**: ordinary sheet CSV → native grid (no CRM writes); "import as contacts" → `ContactImportService` (preview via the matcher, review, resumable idempotent commit, `Contact.importBatchId`). Lead import should reuse `ImportBatch`.
- **Shared block documents (POC, doc/10 §15):** `DocumentContent` (versioned whole-document JSON), `PUT …/content` with expectedVersion (409 = rebase), SSE `…/stream` (updated + presence) via in-process `documentHub` + 2 s version check; client `liveBlocks.ts` rebases per block. Maps/sheets still device-local.

## Communication Agents (2026-10-07) — spec: `docs/agents/` (roadmap `07-implementation-roadmap.md`)

- Email-first automation surface: Agent (instance of a built-in type) → AgentMessage (email blocks) → AgentEvent (river row) → delivery per destination → target per recipient (frozen render). No workflow engine; types live in `services/agents/registry.ts`.
- **Senders:** `EmailConnection`, referenced by Agents (null = workspace default). Every workspace gets "Send with 8080" (`platform`) at creation, Reply-To = creator's email; UI shows only "Send with 8080" vs "Use my own email/domain" — SMTP/Google/Microsoft/Resend domain are strategies (S5). Agent code never branches on strategy (`providerFor`).
- **Runner** (`services/agents/runner.ts`): in-process tick, single instance, conditional-update claims + lease. Retries: transient errors only, 3 attempts, 2 min apart, each in `AgentSendAttempt`; auth failure stops the delivery. Failed events → one `agent.failed` ActivityEvent. One upcoming event per active scheduled Agent (`scheduleNext`), never backfilled.
- **S1 (Team):** Daily team brief + Daily customer report; one event → email to active members + one company-chat post by the workspace host (destinations fail independently; chat not retried). Agents desk in the work nav (`?desk=agents`). Sender settings live in Company › Integrations, not in Agents.
- Platform email env (server service on Railway): `RESEND_API_KEY`, `EMAIL_PLATFORM_FROM` (`Name <address>` ok). Production always uses Resend and fails visibly without them; tests always use the dev outbox; local dev sends for real only with `EMAIL_TRANSPORT=resend`.
- Team Agents ship to production first; customer bulk email stays behind the S8 compliance gate. Templates/themes are their own email system (`presentation.ts`), not Documents blocks.

## Key Design Decisions

- Items numbered per room: `Room.itemCount` incremented inside the createItem transaction; `@@unique([roomId, number])`.
- `Room.number` uses `@default(autoincrement()) @unique` — verified working on MySQL 8.
- Server stores only `parentId`; branches computed client-side (`apps/web/src/utils/graph.ts`).
- Private rooms return 404 to non-members (don't leak existence).
- SSE `reactions[].reacted` is always false (broadcast); `StreamEvent.actorId` lets clients keep their own reacted state.
- Auth template `AuthService` returns raw Prisma users — **Phase 2 must serialize** to the `User` schema (never leak `passwordHash`). Response schemas also strip unknown fields via fast-json-stringify.

## http.ts → SDK migration (Phase 4)

1. Adapter: implement the existing `Api` interface (`apps/web/src/api/types.ts`) over `getApiClient()`; add `roomId` to the interface. Views unchanged.
2. Replace with SDK hooks (`useRoomItems`, `useCreateItem`, `useReaction`, `useUploadMedia`, `useRoomStream`) and SDK model types (`@project/sdk` exports `Item`, `Room`, `Media`, …). Delete `api/identity.ts` (cookie session replaces it).

| http.ts | SDK |
|---|---|
| `getItems()` | `GET /rooms/{roomId}/items` (paginate; `after` for catch-up) |
| `createItem({text, media})` | `POST /rooms/{roomId}/items` `{ parentId, text, mediaIds }` — author from session |
| `addReaction(id, type)` | `PUT /items/{itemId}/reactions/{type}` (+ `DELETE` to remove) |
| `uploadMedia(input)` | `POST /media` multipart (same FormData fields) |
| `subscribeToItems(cb)` | `EventSource('/rooms/{roomId}/stream', { withCredentials: true })`, per-item events → `upsertItem` |

## Local Environment

- MySQL 8 local; databases `voice_chat_dev` / `voice_chat_test`, user `voice_chat` (creds in root `.env`, gitignored). `packages/db/.env` is a **symlink** to it for the Prisma CLI.
- Push schema to test DB: `set -a; . ./.env; set +a; DATABASE_URL=$TEST_DATABASE_URL pnpm db:push`
- **Type-check = `pnpm typecheck`** (root; runs each package's `typecheck`, for web `tsc -p tsconfig.app.json --noEmit`; CI runs the same). `vite build` alone never type-checks; `pnpm --filter web build` does it first.

## Phase Completed

Phase 2 — Server (2026-09-30)

## Modules Built

- [x] Schema: User/Profile/Session, Room/RoomMember, Item, Media, Reaction
- [x] OpenAPI spec: 22 operations (auth, users, rooms, items, reactions, media, stream)
- [x] SDK: client, generated types, model aliases, useAuth (+ useGuestSession)
- [x] Server (Phase 2): 22 handlers, services, StreamHub (SSE), local storage, rate limits; 79 tests passing
- [x] Domain SDK hooks (Phase 4 step 19): useRooms/useMyRooms/useRoom/useCreateRoom/useUpdateRoom/useJoinRoom/useLeaveRoom/useRotateInviteCode, useRoomItems (auto-fetches all pages; returns `items`)/useItem/useCreateItem/useDeleteItem, useSetReaction, useUploadMedia/uploadMedia, useRoomStream (merges SSE into cache; `onEvent` for zustand), useGuestSession. Keys in `hooks/keys.ts`; `unwrap()` + `getApiBaseUrl()` added to client.ts.
- [x] Frontend on the SDK directly (adapter/mock/identity.ts were removed by the UI owner; decision: keep direct SDK migration, no mock parity).
  - `main.tsx`: `createApiClient()` once. `app/App.tsx`: `useSession()` (idempotent `POST /auth/guest`, key `['me']`) gates rendering.
  - `views/Room.tsx`: `useRoomItems().items` → `state/data.ts` via `replaceItems`, keyed on `dataUpdatedAt` only (no dependency on store data → no replace loop). SDK cache is the single source (fetch, mutations, SSE all land there). Reactions toggle with `on: !reacted`. Reply `parentId` sent in replying/composing/recording/reviewing.
  - `app/useRoomRef.ts` (DEV-ONLY): `/room/demo` → shared "OPEN CHANNEL" room; `/room/<id>?invite=CODE` joins first. `views/Home.tsx` lists real public rooms.
  - `api/adapt.ts`: SDK → frontend type mapping (`reacted` carried through). `media/service.ts` uses SDK `uploadMedia`.
  - SDK fix: `useRoomStream` always keeps the viewer's cached `reacted` flags (broadcasts carry false).
  - Verified in headless Chromium, 23/23 across repeated runs: render/header/footer, compose/reply UI flows, /room/demo + Home, SSE idle, SSE during active playback (same <audio> element keeps playing), reaction on/off incl. own-flag survival, reply via UI, fake-mic record→review→send upload.
- [x] Type cleanup — `apps/web` typechecks clean (0 errors), so root `pnpm typecheck` passes for every package.
  - `components/polymorphic.ts`: `PolymorphicProps<T, Own>` — `as` accepts any ElementType (tags or `motion.*`), props/`ref` typed from it. Used by Panel, Stack, Label, Grid, **Control**.
  - Control previously ignored `as`, so `as={motion.button}` rendered a plain <button> with motion props leaked as DOM attrs — the record button's drag-to-cancel and `layoutId` never worked. Now real.
  - `styles/motion.ts` grammar typed with `satisfies Transition/MotionProps` (keeps literal types); Feed variants typed `Variants`.
  - Send path typed end-to-end: `api/types.ts` `LocalMedia` (duration in **seconds**) + `SendInput`; `Instrument.onSend(input: SendInput)`; `Room.send` uses `isLocalMedia`. Legacy `Api`/`UploadInput`/`CreateItemInput` removed.
  - Fixed: Instrument sent `durationMs` as `duration` (now `/ 1000`). Room `Blobs` count used nonexistent `room.occupants` (always 3) → `memberCount`.
  - Live suite 25/25 ×2 incl. duration-in-seconds and no motion-prop DOM leaks.
- [x] Capture/playback defect pass (2026-10-01), verified in headless Chromium (capture suite 19/19):
  - **Server audio was silent**: Media routes <audio> through a WebAudio StereoPanner; cross-origin media without `crossOrigin="anonymous"` outputs zeroes. Fixed (server already sends ACAO on /uploads). Verified by tapping the graph: peak 0 → 0.244.
  - **No way to play server audio from the UI**: audio without a waveform rendered a static "AUDIO FILE" box. Now a clickable progress bar (play/pause, duration) that routes through `ui.startPlayback` (highlight, auto-advance). Items with replies show the previously unreachable Keep playing / Follow replies options.
  - Playback stalled forever on text/image/file items (nothing fires `ended`): Item now dwells then advances — see Locked Behaviors for timing.
  - Follow-replies used `parentId` as the thread root (one level); now `ancestorsOf(...).at(-1)`.
  - WebAudio graph: one per media element (`WeakMap`), reused across StrictMode remounts, closed on real unmount. Waveform-decode AudioContext closed after use.
  - Capture start awaits the device: on failure returns to idle / resumes playback and shows a human error (blocked / not found / in use / unavailable). Stop ignored until actually recording.
  - Drag-to-cancel (newly reachable after the Control `as` fix) goes through the same cancel/resume path; click-after-drag suppressed.
  - Send buttons disabled while sending (no duplicate items); upload failure shown in the review takeover, blob kept for retry. Video capture snapshots/resumes playback like audio.
  - Anchors reply tether: 0–100 viewBox, unitless path, non-scaling stroke — now draws.
- [ ] Live presence for Blobs: `memberCount` is membership, not who's here now. StreamHub already knows connections per room (`connectionCount`) if presence becomes a product need.

## Last Session Summary

Phase 1 done: monorepo scaffolded (existing app moved to `apps/web`), Prisma schema validated, spec lints clean, `sdk:generate` + `sdk:check` pass, backend packages typecheck.

Open items:
- `apps/web` typecheck currently fails due to an in-progress UI refactor (ui.ts SpatialState, Instrument.tsx) happening outside this session — not caused by the move.

Phase 2 done: `pnpm test` 79/79 (stable over repeated runs), live smoke via curl passed (guest → register upgrade → room → upload → item → SSE event → logout 401). `buildApp({ rateLimit })` — tests disable limits except `rate-limit.test.ts`.

SDK hooks done and smoke-tested against the live server (upload via FormData passthrough, ApiError codes).

SDK cutover done and verified (see Modules Built). Server: `RATE_LIMITS=off` env disables per-route limits for local multi-browser testing (guest creation is 20/hour/IP otherwise).

Message/Item split + multi-room share completed (2026-10-01) — see "Message / Item model" above. Server 95/95; browser transport 25/25 and capture/playback 19/19 on 3 consecutive fresh-server runs; dwell 7/7.

Playback + spatial-feed polish (2026-10-01): desktop timeline follows the playhead horizontally (was vertical-only — playhead could sit off-screen); focus treatment via `[data-focus]` (active/upcoming/receded/target; signal numeral + hairline only); threads as hairline branches with capped depth indent and a live (signal) line while the playhead is inside; restrained return control; record instrument + return control truly centred (motion owns `transform`). Fixed `utils/graph.ts` `ancestorsOf` (returned only the direct parent — its "self-parent" check always fired), which also fixes thread-root traversal/expansion. Browser polish suite 31/31 on 4 consecutive runs (desktop 1440×900 + mobile 390×844 touch); transport 25/25, capture/playback 19/19, dwell 7/7; server 96/96.
NOTE: test servers — the UI owner's `apps/e2e` runs its own servers on 3001/5173 (rate limits on). Run scratchpad browser suites on an isolated pair (API :3002 with `RATE_LIMITS=off`, Vite :5174 with its own `cacheDir` — two Vite instances sharing `node_modules/.vite` break each other). The polish suite deletes one upload on purpose (broken-media test). The test DB is shared with the editors' tree, whose test runs wipe it — re-seed right before measuring.
NOTE: a new `apps/e2e` package (Playwright, created by the UI owner) has npm's placeholder `test` script, so root `pnpm test` (and CI) fails before reaching the server suite. Give it a real script or exclude it.

Next: product work — capture/playback polish, branch presentation, text entry, motion, visual system. Dev DB contains a few smoke-test rows (guest users, "Smoke room", "SDK smoke").