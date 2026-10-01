# YouTube as a Media Source — Spec

**Status:** implemented (2026-10-01) as specified below. Verified: server 117/117 (9 YouTube + parser), simulated-YouTube browser suite 16/16, real-YouTube smoke 5/5, all prior suites still green.

## Principles
- Captured, uploaded and YouTube video all become the same playable parent item. Anchored replies work the same way for all three (`doc/05`).
- No YouTube media is ever downloaded or stored. Only the canonical video ID plus metadata is kept.
- YouTube-specific code stays in a few isolated places: `packages/shared/src/youtube.ts`, `apps/server/src/services/YouTubeService.ts`, `apps/web/src/media/youtube/*`, and `components/YouTubeMedia.tsx`.

## Findings (verified 2026-10-01)
- This environment can reach the YouTube IFrame API, oEmbed and `i.ytimg.com`.
- oEmbed returns title/author/thumbnail. It returns 400 for nonexistent IDs and resolves `watch`, `youtu.be` and `shorts` links. It does **not** return duration (that would need a Data API key).
- So **duration comes from the client's player** (`getDuration()`). This matches the V1 trust model for uploads. Embeddability also comes from the client: player errors 101/150 mean "embedding disabled".
- The River renders media via `<Media type src poster name>`. `Media` should detect a YouTube `src` with the shared parser and delegate to `YouTubeMedia`, so **the River needs no changes**.
- Home has its own `handleSend` (it maps `isLocalMedia` → upload). YouTube drafts need a shared resolver (e.g. `resolveMediaIds`) used by both `Room.send` and Home, or Home would send undefined IDs.

## Contract (to apply)
`Media` (API) gains:
- `source: 'stored' | 'youtube'` (required)
- `externalId: string | null`
- `title: string | null`
- `embeddable: boolean`

For YouTube: `type: 'video'`, `url` = canonical watch URL, `poster` = `i.ytimg.com` thumbnail, `mimeType: 'video/x-youtube'`, `size: 0`, `duration` = client-measured seconds, or null when not embeddable.

New operation `POST /media/youtube` (`createYouTubeMedia`, rate limit 30/min):
- Body: `{ url: string(1..2048), durationMs?: int ≥ 0, embeddable?: boolean = true }` → `201 MediaResponse`.
- Server: parse with the shared parser, else 400 `INVALID_YOUTUBE_URL` (playlist-only links included). oEmbed lookup (pluggable for tests): 400/404 → 400 `YOUTUBE_UNAVAILABLE`; 401 → embeddable=false. Store title from oEmbed. If not embeddable → duration null.
- Attaches through the existing `mediaIds` flow; sharing reuses it unchanged.

Prisma `Media`:
- `storageKey String? @unique` (nullable)
- `source MediaSource @default(stored)`
- `externalId String? @db.VarChar(32)`
- `title String? @db.VarChar(300)`
- `embeddable Boolean @default(true)`

`toMedia` builds the URL from `externalId` for YouTube.

Anchors need no rule change: a non-embeddable video has null duration → `ANCHOR_UNSUPPORTED`. An embeddable video with a duration counts as the parent's one timed (video) attachment.

## Web
- `media/controller.ts`: a `PlayableMediaController` interface (`play`/`pause`/`seek`/`getCurrentTimeMs`/`getDurationMs`/`onEnded`), plus an HTML element adapter and a WeakMap registry keyed by `[data-media-controller]`. `Item.replyHere` reads time through the registry instead of `querySelector('audio, video')`.
- `media/youtube/api.ts`: a single loader for the IFrame API. `media/youtube/controller.ts`: an adapter over `YT.Player` (host `youtube-nocookie.com`, `playsinline`).
- `components/YouTubeMedia.tsx`: shows a thumbnail placeholder until active, upcoming or tapped, then the player.
  - **Our own timeline underneath:** progress hairline, time readout, seek, and the existing `AnchorRail`. Never YouTube's native progress bar.
  - **Playback states:** active → play; inactive → pause; ENDED → `onEnded`.
  - **Errors:** 2/5/100/101/150 → a fallback card (thumbnail, title, OPEN ON YOUTUBE). If the item is playing, treat it as ended so continuous playback goes on.
  - **Blocked play:** if play doesn't start within about 2.5s, show TAP TO CONTINUE.
- `Item`: `playable` excludes non-embeddable YouTube, which falls back to the dwell. `anchorableMedia` already excludes it because its duration is null.
- Composer (Aa takeover; no redesign): a pasted YouTube link (`findYouTubeVideoId`) shows `YouTubePreview` under the textarea, which resolves duration, embeddability and title. Send waits for that to resolve, then removes the link from the text and posts `{ kind: 'youtube', url, durationMs, embeddable }`. That's resolved to a media ID through `createYouTubeMedia`.
- A small "YOUTUBE" label; YouTube must not dominate the post.

## Tests (to write)
- **Server:** the parser formats (done in the scratchpad check; move them into vitest), the endpoint (canonicalization, invalid/playlist/unavailable via a stub lookup, embeddable=false → null duration), anchors on a YouTube parent (allowed with duration; `ANCHOR_UNSUPPORTED` when not embeddable), share carrying the YouTube media, and the `toMedia` shape.
- **Browser:** a deterministic fake `YT` API (served by intercepting `/iframe_api`) for state, error and end semantics; REPLY HERE at the player's time; markers on our timeline; the fallback card for 101/150; paste → preview → post. Plus one real-YouTube smoke test (an embeddable video without ads, e.g. Blender's Big Buck Bunny `aqz-KE-bpKQ`).
