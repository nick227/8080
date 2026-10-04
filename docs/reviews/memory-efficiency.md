# Efficiency review — 2026-10-04

Scope: static inspection of web rendering/state, SDK pagination and stream updates, server bot selection and mute caching, and camera/audio processing. This is a targeted review, not a production heap profile or an exhaustive audit of every loop. Existing conversation-layout changes are preserved.

## Implemented

| Flow | Previous cost | Change |
| --- | --- | --- |
| Bot scoring | Candidate × history scans, per-candidate filtered arrays, fallback membership scans | Index relevant history once; keep latest use and daily count; use a set for eligible keys; consolidate fallback selection. History processing becomes O(lines + history), with O(lines) bounded index storage. Intent matching still depends on intents per line. |
| Camera stabilizer | One width × height byte allocation per frame, followed by a separate metrics traversal | Read the previous alpha directly from persistent ImageData before overwriting each pixel. Compute temporal metrics during the existing output pass. No extra history buffer. |
| Playback lookahead | Copy remaining history, filter it all, slice two items, map IDs | Scan forward and stop after the first/next two playable items. No intermediate arrays. Initial active-item lookup remains linear; branch mode still constructs its traversal. |
| Audio decode | Copy the complete downloaded ArrayBuffer before decoding | Pass the exclusively owned response buffer directly to the decoder. |
| Waveform normalization | Spread peaks for max and allocate a second result array | Track maximum during sampling and normalize the locally owned array in place. |

Shared React/Zustand/query state remains immutable. In-place writes are appropriate for owned scratch buffers and new local arrays, not published state snapshots. Camera smoothing and spatial feathering remain separate passes: feathering must read a fully updated confidence frame.

## Validation and measurements

- Web and server TypeScript checks.
- `pnpm exec tsx scripts/test-efficiency.ts`: bot exclusion/fallback/freshness behavior, mask output bytes, temporal metrics, resize reset, waveform normalization.
- Temporary differential harness against pre-change source: 500 seeded randomized scoring cases and 30 mask frames including resizing matched exactly for scoring results, confidence, and statistics.
- Synthetic Node benchmark, warm-up followed by 100 iterations, one local run:
  - 1,000 candidate lines / 5,000 history entries: 21.06 ms → 0.345 ms per scoring call (about 61×).
  - 512×288 mask: 7.93 ms → 7.60 ms per frame with mocked canvas upload. This excludes GPU inference, real canvas upload and compositing; it is not an end-to-end camera speed claim.
- Structurally removed: 147,456 bytes (144 KiB) allocated per 512×288 mask, or 4.22 MiB/s at 30 masks/sec. This is allocation volume, not measured retained-heap savings. Decode avoids one allocation equal to the compressed audio file size.

## Remaining findings, ordered by likely value

1. **Mute cache retains inactive viewers indefinitely** (`apps/server/src/services/MuteService.ts`). Five-second TTL controls freshness but does not evict entries. Add a bounded cache with expiry eviction; measure unique viewers and retained mute-set sizes. Avoid a full-cache scan on every request; use bounded periodic sweeping or an eviction queue. Also consider sharing in-flight reads for a viewer.
2. **Loaded room history has no explicit page retention limit** (`packages/sdk/src/hooks/useItems.ts`). Every update flattens/deduplicates the loaded window and sorts it, O(N log N). The UI then converts every item again and builds more indexes (`apps/web/src/views/Room.tsx`). Profile long sessions, introduce an explicit history retention policy compatible with scroll-back, and reuse unchanged item conversions. Do not blindly reverse pages: live additions, overlap and deduplication semantics must be preserved.
3. **State updates repeat indexing and retain dangling child IDs** (`apps/web/src/state/data.ts`). Add/upsert share insertion logic; replacement keeps both a sorted temporary list and another ordered item array. Reuse the locally sorted list, share insertion helpers, and prune the deleted item's parent membership. Binary search reduces insertion comparisons but array copying/shifting remains O(N). Published snapshots still require immutable updates.
4. **Reply counts construct and sort whole branches** (`apps/web/src/utils/graph.ts`). Counting needs neither sorted siblings nor an array of all result items. Use an iterative visited-set counter; for many counts in the same render, consider a cached subtree-count index with explicit invalidation. Retain cycle and missing-parent protection. Existing branch sorting also assumes every child ID resolves, which conflicts with state deletion leaving dangling IDs; fix that before relying on a cached sorted index.
5. **ONNX input allocates a 3-channel Float32Array for every inference** (`apps/web/src/features/vbg/ort.ts`). At 512×288 that is 1.69 MiB/frame before canvas readback and tensor outputs. Reuse a dimension-keyed, source-owned input buffer only after proving inference calls cannot overlap and that tensor disposal does not invalidate it. Audit tensor/session ownership, failure cleanup, and source replacement before adding reuse; async inference makes global scratch buffers unsafe.
6. **Room tile layout checks every possible column count on resize** (`apps/web/src/features/room/RoomFloor.tsx`). O(participants) per resize, generally small. Target arrays also rebuild during capture-driven renders. Memoize stable participant-derived data only if profiling shows meaningful churn. Prefer this lower priority over complex arithmetic approximations that could alter layout.

## Next profiling pass

Record browser allocation timelines for a long room session and a 60-second camera capture. Separate JS heap, ArrayBuffer/external memory and GPU resources. On the server, compare retained cache size against unique viewers and record scoring p50/p95 at real pool/history sizes. Use those results to choose retention limits and buffer ownership changes; synthetic timings alone do not establish production impact.
