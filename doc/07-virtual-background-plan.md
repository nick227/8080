# Virtual Background (camera) — Spec

**Status:** implemented (2026-10-03) — see *As built* at the end for where it differs from the plan below. Scope: replace or blur what's behind the person in the live camera feed, in the browser, for framing and recording. Out of scope: audio effects and other editor features.

## Principles
- **The canvas is the camera.** When the effect is on, one canvas is both the preview and the recording source. What you see while framing and recording is what gets saved. Nothing is rendered after recording, so Save stays the fast path (the soundtrack remux and `videoFrame` stills work on the result unchanged).
- **Choose before you record.** The background is baked in while recording, so it's chosen while framing. A finished take can't be re-backgrounded (that would need a hidden re-render pass, which we don't do).
- **Never break a recording.** If segmentation fails or falls behind mid-take, the compositor keeps painting the same canvas, with the last good mask or the raw camera. The `MediaRecorder` track never changes.
- **Locked camera behavior still holds:** the camera is held only while framing or recording (CLAUDE.md). The compositor never opens or keeps the camera itself.
- **Lazy and optional:** nothing loads unless the user picks Blur or Photo. Original is the default and costs nothing.

## Choices
- **Segmentation:** `@mediapipe/tasks-vision` `ImageSegmenter` (v1.0.1), `selfie_segmenter` model (~250 KB), `runningMode: 'VIDEO'`, confidence mask for the person. Delegate: GPU, falling back to CPU. The WASM runtime is ~11.7 MB (SIMD build; a no-SIMD fallback exists), so it's dynamically imported on first use, like the mediabunny chunk.
- **Compositing: Canvas 2D, not WebGL, for the MVP.** The mask is small (model resolution, ~256×144), so per-frame work is a few `drawImage` calls. No `ctx.filter`: Safari support is patchy, and downscale-then-upscale gives the blur and feathering we need everywhere. Move to WebGL only if profiling demands it.
- **Frame clock:** `requestVideoFrameCallback` on the hidden camera `<video>` where available, otherwise `requestAnimationFrame`.

## 1. Rendering pipeline
```
camera MediaStream ─► hidden <video> ─┬─► segment (every Nth frame, ~256×144) ─► mask (alpha = confidence)
                                      │                                             │
                                      │                     temporal smoothing: smooth = 0.6·new + 0.4·previous
                                      │                     (draw new mask over the previous one with globalAlpha)
                                      │                                             │
                                      ▼                                             ▼
  out canvas (≤1280×720):  ① background  ─  photo (cover-fit, drawn once per change to a cached canvas)
                                             or blur (camera drawn at 1/16 size, upscaled = cheap blur)
                           ② person      ─  camera frame, then 'destination-in' with the smoothed mask
                                             upscaled with smoothing on (bilinear upscale = feathered edge;
                                             one extra low-res box blur pass widens it for hair/shoulders)
                           ③ draw person over background
```
- **Jitter and flicker:** the temporal blend above, plus a small confidence curve (`smoothstep(0.35, 0.65, c)`) applied when the mask is written. This removes edge shimmer without a hard threshold.
- **Mask reuse:** between inference frames, the last smoothed mask composites the new camera frame. On Firefox or slow devices, segment every 2nd or 3rd frame at the same low resolution.
- **Mirroring:** the canvas stays unmirrored, like recordings today; `CameraPreview` keeps its CSS mirror for the front camera. As a result, the background photo looks reversed while framing but correct in the recording. MVP accepts this; the fix is to draw the photo pre-flipped in the preview only (see Decisions).

## 2. Recording pipeline
- `useMediaCapture.start('video')` already gets `{audio, video}` from `getUserMedia`. When the effect is on, it hands that stream to the compositor. The compositor returns `new MediaStream([canvas.captureStream(30) video track, the mic audio track])`. `MediaRecorder` records that stream, and `publishLiveStream` publishes it, so `CameraPreview` shows the composite during the take.
- `disposeStream()` stops the compositor and then the camera and mic tracks as today. The take is an ordinary webm/mp4, so review, the soundtrack remux, thumbnails and upload need no changes.
- **Framing to recording handoff:** framing (`CameraPreview`'s own stream) and recording use separate camera sessions (CLAUDE.md). The segmenter is a module singleton that stays warm across both, so only the source `<video>` is re-attached. This keeps the existing one-blink handoff and avoids a second model load.
- **Model still loading:** Record is disabled and the strip says "Loading background…"; ORIGINAL is the escape hatch. A take never records something other than what's on screen.

## 3. Fallback behavior
| Condition | Result |
|---|---|
| WASM/model fails to load, or no WebGL for the GPU delegate | retry on CPU delegate; if that fails, mode → Original, message "Background effects aren't available on this device" |
| Too slow (rolling 2 s window: composite < 15 fps or segmentation > 50 ms) | step down: segment every 2nd frame, then every 3rd frame at 640×360 output, then Original with a message |
| Failure mid-recording | keep painting the same canvas with the last good mask, else the raw camera; the recording continues |
| Tab hidden while recording | rAF/rVFC pause, so the canvas stops updating and the video freezes for that stretch (same limitation as any canvas recording); noted, not mitigated in MVP |

## 4. Browser limitations
- **Chromium:** GPU delegate, `requestVideoFrameCallback` and `canvas.captureStream` are all available. Expected path: every-frame segmentation at 720p output.
- **Firefox:** `captureStream` and MediaRecorder of a canvas work (our capture already records VP8 there). GPU-delegate support in MediaPipe on Firefox is unreliable, so plan on the CPU delegate with every-2nd-frame segmentation. `requestVideoFrameCallback` exists only in recent versions, so it falls back to rAF.
- **Safari/iOS:** best effort. Canvas 2D-only compositing avoids `ctx.filter`. Memory limits make the 11.7 MB WASM runtime the main risk.
- **Hidden tabs** throttle the compositor (above).
- **Download size:** ~11.7 MB WASM + ~250 KB model on first use, cached by the browser after that.

## UI (MVP)
- Shown in **camera mode only, while framing**, as one compact strip under the stage: `ORIGINAL · BLUR · [photo thumbs] · +` (the `+` picks the user's own photo). The selected item uses the signal colour. During a take it's hidden with the other controls. It doesn't exist in review, where the background is already baked in. Stock photos are the existing `STOCK_IMAGES`.
- State: `state/background.ts` (zustand), `{ mode: 'original' | 'blur' | 'photo', photo: { id, url } | null, status: 'idle' | 'loading' | 'ready' | 'unavailable' }`. Mode and stock photo id persist in localStorage. A user photo lasts for the session only in the MVP.

## Files (MVP)
- `features/virtualCamera.ts`: lazy segmenter singleton, `startCompositor(stream, options) → { stream, setOptions, stop }`, frame loop, quality tiers.
- `state/background.ts`: the choice and status above.
- `features/CameraPreview.tsx`: when mode ≠ original, routes its framing stream through the compositor.
- `features/useMediaCapture.ts`: wraps the recording stream when mode ≠ original; stops the compositor in `disposeStream`.
- `features/room/RecordSurface.tsx`: the strip under the stage in camera framing.

## Verification plan
- Chromium fake capture with a person clip (`--use-file-for-fake-video-capture=person.y4m`; needs a short royalty-free clip). Firefox's fake camera can't take a file, so Firefox gets a smoke test: the effect runs, falls back cleanly, and records.
- Measure fps and segmentation ms per browser and quality tier.
- The recorded take is composited: sample pixels in a known background region and match them to the photo.
- Camera release: reuse the live-track probe (framing 1, recording 1, review 0, closed 0) with the effect on.
- Record pressed while loading: either the effect is used or Original is recorded with the message; never a hang.
- Existing suites stay green.

## As built (2026-10-03)
Decisions: strip under the camera while framing; runtime self-hosted (Vite plugin `mediapipe-runtime` in `vite.config.ts` serves the 4 WASM files from `node_modules` in dev and emits them to `dist/mediapipe/`; model committed at `public/models/selfie_segmenter.tflite`, 250 KB); photo pre-flipped in the mirrored preview (preview canvas ≠ recording canvas); user photo kept in IndexedDB (`8080` / `kv` / `background-photo`).

Differences from the plan:
- **CPU delegate everywhere.** Measured in headless Chromium: GPU delegate (software GL) ~190 ms/frame + 1.3 s first call; CPU (XNNPACK) 14–18 ms, 24–28 fps composite. Firefox CPU: 14–31 ms. No GPU readback either.
- **Record is disabled until ready** (no 3 s wait-then-fallback).
- **Degradation:** full → every 2nd frame → Original (Firefox starts at every 2nd frame). A mask older than 500 ms is not trusted: raw camera, never a frozen cutout. A new compositor is seeded with the last mask (<1 s old), so a take starts composited from its first frame.
- **Firefox detection is by feature** (`CSS.supports('-moz-appearance', 'none')`): user agents get overridden (the Playwright config forces a Chrome UA).

Verified (Playwright, fake camera fed a person clip; isolated :3002/:5174): load 0.3–0.6 s, Record disabled while loading; framing preview composited (photo and blur); recorded take composited from frame 1 (ffmpeg frames); mirrored preview flips the person but not the photo, recording unmirrored; own photo survives a reload; ORIGINAL enables Record immediately; camera live tracks framing 1 / recording 1 / review 0 / closed 0; Firefox smoke (ready ~2.3 s, records). Known: in this static test clip, a flag touching the subject bleeds through at the edge.

## Quality tuning (2026-10-03, after a real-webcam test showed a halo)
Measured on a 1280×720 person clip (headless Chromium), readout numbers:
- No downscaling: camera 1280×720 → canvas 1280×720 (cap raised to 1920 so a 1080p camera isn't reduced). Camera request unchanged: ideal 1280×720 @ 30.
- **Segmentation ≈ 20 ms at 256, 384 and 512 alike**: the model runs at a fixed internal size; a larger input only improves the returned mask's upsampling. 384 is marginally cleaner than 256, 512 adds nothing visible. Default 384.
- **Matte v2 is the main fix:** motion-aware temporal smoothing (steady pixels averaged, moving pixels follow at once — no trails), firmer confidence curve (0.4–0.8), 1-mask-pixel erosion (min filter), then a 3×3 feather. Removes the bright halo and nearly all colour bleed without visibly cutting hair or shoulders; v1 left fringes trailing on motion.
- **Recording bitrate** explicit: 6 Mbps ≤ 720p, 10 Mbps above, 2.5 Mbps ≤ 480p; audio 128 kbps. 6 Mbps is ≈ 45 MB/min of video alone (audio + container add a little); the upload cap was raised to 100 MB (`MAX_UPLOAD_MB` in `packages/shared/src/limits.ts`, used by the server default and an SDK pre-check) ≈ 2 minutes.
- Temporary tuning hooks: `localStorage['8080.vbg-tune'] = '{"seg":256|384|512,"matte":"v1"|"v2"}'` and a readout (`VbgReadout`, dev builds or `localStorage['8080.vbg-debug']='1'`) showing camera/canvas/segmentation sizes, segmentation ms and rate, draw fps, recording MIME and bitrate. Remove both once tuned on real webcams.

## Motion (2026-10-04, after a real-webcam test lost a fast-moving forearm)
- **Cause #1 was our throttle, not inference:** the real Firefox readout showed 20 ms segmentation but `tier 1` (every 2nd frame) — Firefox was started halved by design, and tiers could only step down. Now every browser starts at full rate; tier 1 → 0 again when segmentation + draw < 28 ms. Measured (headless Firefox, 1280×720): tier 0, 26 masks/s (was ~13), segmentation 18 ms, draw 8.6 ms. Headless Chromium stays at tier 1 only because software canvas drawing costs ~20 ms there.
- **Adaptive erosion (v2 default):** where the raw mask changed > 0.15 since the previous segmentation, the 1-pixel contraction is skipped in that 3×3 neighbourhood; static edges keep it. Fast-motion clip: person coverage 22.1% (fixed) → 23.1% (adaptive); static clip identical (21.9% both — no halo regression). `v2-fixed` keeps the old behaviour for A/B.
- Readout adds draw ms, engine and `fg %` (share of mask pixels that are person).
