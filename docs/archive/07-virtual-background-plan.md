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

## Blur fix (2026-10-04, black blocks in a real-webcam test)
- **Cause:** Blur shrank the camera 24× in one `drawImage`, then enlarged it. Firefox downsamples by point sampling, not averaging, so thin dark details (a lattice behind the subject) became solid dark pixels, then large black blocks; the whole background looked pixelated. Chromium averages, so it didn't show. No transparency or mask data was involved — the path read only the raw camera.
- **Now:** raw camera → 2× halving steps (each averages) → native `ctx.filter = blur(5px)` at quarter size, overscanned by the radius with `copy` compositing (opaque, edges can't bleed in) → upscaled; filter/alpha/composite reset explicitly before the person is drawn. No `ctx.filter` (Safari): two more halving steps instead.
- Measured on a lattice clip (Firefox, 1280×720): near-black pixels in the background strip 3.9% → 0%; draw 12.4 ms (was 10.6). A full-size `blur(18px)` was also measured: same look, 35.9 ms — rejected.

## Demo polish (2026-10-04)
- **Camera:** ideal 1920×1080 @ 30 (720p and lower still work). Recording 10 Mbps above 720p.
- **Matte:** confidence-weighted temporal smoothing (confident steady pixels keep up to 75%, uncertain/moving follow at once); motion-aware feather (moving edges firm, no blur; still edges 3×3 feather) on top of adaptive erosion.
- **Polish layers** (`polish`, on by default): edge-ring colour decontamination (quarter-size blurred copy of the cut-out person — alpha-weighted, so foreground-only colour — drawn `source-atop` over the matte's edge ring); photo softened (`blur(W/900) contrast(0.92)`) once per photo/size; photo brightness eased toward the person-weighted camera luminance (√ ratio, clamped 0.75–1.25), baked only when it moves > 2%; soft contact shadow (quarter-size blurred mask, 28%, offset down-right) in Photo mode. No edge sharpening: Canvas 2D has no cheap localized unsharp mask — a WebGL pass, out of scope.
- **Budget ladder** (budget = camera frame interval − 3 ms, e.g. 37 ms at 25 fps): polish off → canvas ≤ 1280 wide (framing only; the recording compositor inherits the learned size via `fixedSize` and never resizes mid-take) → segment every 2nd frame → Original. Full-rate segmentation is protected because it's what tracks moving hands.
- **Measured (headless Firefox, software canvas):** 720p draw 7.4 ms without polish vs 18.9 ms with (first build; reduced since by baking brightness and quarter-size blurs); 1080p 16.8 ms without polish. With the ladder, 720p settles at polish off / full-rate (25.6 masks/s); 1080p at polish off / 1280-wide canvas / every 2nd frame. Real GPU-accelerated canvases are expected to keep more of it; the readout shows what the ladder chose (`polish on|off`, canvas size, tier).
- Visual: the photo treatment (brightness match + softening) is the clearly visible gain; decontamination is subtle; the shadow is faint by design.

## Blur pass 2 (2026-10-04, residual blocks on a real Windows webcam)
- Not reproducible in headless Firefox (software canvas): 1080p blur came out smooth. Two likely real-device causes, both addressed: (1) **`ctx.filter` combined with `globalCompositeOperation = 'copy'`** — GPU canvases (Firefox/Direct2D on Windows) may not honour the filter in that combination, which would leave the raw quarter-size buffer enlarged 4× = stair-step blocks. All filtered draws now use an opaque fill (or `clearRect`) + normal `source-over` drawing. (2) A **4× upscale** shows pixel structure; the blur now runs at **half size** (radius 10 ≈ 20 px at full) with only a 2× upscale.
- Measured (headless Firefox, lattice clip, 720p, polish off): quarter 13.6 ms vs half 21 ms draw; half is visibly smoother (quarter left a faint block structure). Half is the default and a **budget-ladder step**: polish off → quarter blur → canvas ≤1280 → every 2nd frame → Original. No extra full-size softening pass (a 2× upscale of a well-blurred buffer has no blocks to hide; full-size blur measured 36 ms).
- Readout shows the blur path and buffer size (`blur filter 640×360` / `320×180` / `fallback …`).

## Ladder climb-back (2026-10-04)
- A real readout showed camera 1920×1080 but canvas 1280×720 (polish off, quarter blur) while running at 17.7 + 9.5 ms against a ~33 ms frame: the ladder had stepped down during the expensive startup and was one-way.
- Now, after two calm windows with ≥ 4 ms headroom, the most valuable dropped step is retried for one window (canvas size → half blur → polish); if that window is over budget it's reverted and blocked for 30 s. No trials while recording (`fixedSize`); recordings inherit what framing learned.
- Measured (headless Firefox, 1080p source, Blur): drops at 6/8/10 s; trial of 1920×1080 at 14 s cost 13 + 22 ms (budget ~30) → reverted at 16 s. A 1080p canvas draws ≈ 1.6× the 720p cost here.
- Recording bitrate follows the camera: 10 Mbps for a 1080p camera (even when the canvas falls back to 720p).

## Bitrate follows the output; quality-first order (2026-10-04)
- Recording bitrate is chosen for what is actually recorded — the compositor's canvas when an effect is on (`compositorOutputSize`, from the ladder's current canvas cap), else the camera: **8 Mbps at 720p, 12 Mbps at 1080p** (3 Mbps below). Generous on purpose: quality first, upload size last (≈ 95 s / 65 s under the 100 MB cap). Verified: 1080p camera + Photo with the ladder at 1280 → 8 Mbps; 1080p raw → 12 Mbps.
- The compositor sizes its canvases from the camera track's reported size immediately, so a recorder never starts on the 2×2 placeholder canvas (Firefox may lock onto the starting size). Verified: Firefox and Chromium composited takes are 1280×720.
- Locked order (also in CLAUDE.md): clean extraction → full-rate segmentation → artifact-free background → best sustainable resolution → generous bitrate → upload size.

## v3 matte + the model ceiling (2026-10-04, "subject constantly clipped / breathing")
- **v3 (default):** no erosion; hysteresis (person above 0.5, released only below 0.3) so one uncertain frame can't remove a pixel; confidence-weighted temporal smoothing; small feather. Readout adds **flicker** = mean |Δalpha| between consecutive masks over edge pixels.
- Measured on a noisy, underexposed still clip (cheap-webcam proxy): flicker **10.6% (v2) → 4.7% (v3)**, coverage 22.4% → 24.5%. With an extra 1-pixel outward growth: flicker 5.5%, coverage 25.5%, but it latched chunks of the real room the model rates ~50% person (off by default; `grow` in the tuning switch).
- **The ceiling is the model.** Biasing inward clips the person, outward shows the room; filters only move the artifact. MediaPipe's heavier `selfie_multiclass_256x256` (16 MB) was tried as a drop-in: **~177 ms (Chromium) / ~210 ms (Firefox) per frame on CPU** vs 7–8 ms for `selfie_segmenter` — unusable without GPU inference. Next step is a real matting model on the GPU (see the proposal in the conversation of 2026-10-04): RVM (temporal, GPL-3.0) or MODNet (Apache-2.0) via WebGL/WebGPU.

## Phase 1 pipeline: pluggable mask sources (2026-10-04)
Goal: real-time client-side room replacement at ~85–90% of Teams quality, pluggable to go higher. Key principle: stable edges beat accurate edges — the stabilizer matters more than the model.

**Stages** (`features/vbg/`): camera frame → **mask source** (`types.ts` `MaskSource`: person alpha 0–1 at its own resolution; `backend`, `sync`, `inputSize`, `run`) → **temporal stabilizer** (`stabilizer.ts`: confidence-weighted smoothing, hysteresis 0.5/0.3, no erosion, 3×3 feather, last-mask seeding, 500 ms stale → raw camera, flicker/coverage metrics) → **compositor** (`virtualCamera.ts`: Blur/Photo, polish, budget ladder; one inference in flight, GPU sources run off the main thread while frames keep drawing).

**Sources** (`maskSource.ts`, chosen once per page; framing and recording share it — never switched mid-recording):
1. **MODNet** (`modnetSource.ts`, production default) on **WebGPU only**, input 512×288, ONNX Runtime Web (MIT) self-hosted at `/ort/` (asyncify build, 27 MB WASM) + the MODNet weights (fp32, 26 MB; **not in git** — the `modnet-model` Vite plugin fetches them from a pinned revision, verifies SHA-256, caches them in `node_modules/.cache/models`, serves them in dev and emits them into the build as `/models/modnet-<sha12>.onnx`; notice in `public/models/MODNET-NOTICE.txt`). See *Model provenance* below. Rejected at load if the warm median exceeds 40 ms (≥ ~24 masks/s); one timed run 3× over budget aborts early. WebGL is not practical (ORT's WebGL backend: "int64 is not supported"); CPU WASM measured 360–570 ms.
2. **MediaPipe** selfie_segmenter (fallback), CPU, 384×216, 7–8 ms.
3. **RVM** (`rvmSourceDevOnly.ts`) — **evaluation only**, see licence.

Fallback events are logged and shown in the readout (`fallback modnet/webgpu: …`). Overrides: `localStorage['8080.vbg-source'] = 'modnet' | 'mediapipe'` (+ `'rvm'` in dev builds); dev-only `8080.vbg-nogate = '1'` skips the speed gate for quality comparison on slow machines.

**Licence position (recorded 2026-10-04; not legal advice):**
- MODNet — official ZHKKKe/MODNet states code, models and demos are Apache-2.0; ONNX conversion Xenova/modnet is Apache-2.0. Cleared for production; keep `MODNET-NOTICE.txt` intact.
- RVM — official PeterL1n/RobustVideoMatting is GPL-3.0. Evaluation only: shipping it client-side would likely trigger GPL obligations. Excluded at build time (reachable only through an `import.meta.env.DEV` branch; production `dist/` verified to contain no RVM code, tensor names or dev-model paths); weights only in `apps/web/.dev-models/` (gitignored), served by the dev server, never emitted. No RVM code is shared into production paths (it depends on the generic `ort.ts`, not the reverse). Build-time exclusion is hygiene, not a legal safe harbour — don't distribute a dev build containing it without legal review. Weights licences should be checked separately from code licences for both.

**Offline comparison** (same 16 noisy, underexposed 720p frames, same metric and stabilizer; ORT CPU in Node / MediaPipe in Chromium):

| | raw flicker | stabilized flicker | coverage |
|---|---|---|---|
| MediaPipe | 6.8% | 4.9% | 24.6% |
| MODNet | 12.7% | 6.3% | 23.0% |
| RVM (recurrent) | 6.6% | 3.7% | 23.6% |

Visual (alpha of the last frame): MediaPipe is blobby with room chunks (flag/curtain) attached; MODNet is a clean, crisp silhouette with none; RVM is crisp but kept some background at the head. MODNet's flicker number is inflated by its genuinely soft (wider) edge band. Live speed could not be measured here (no GPU; software WebGPU ran MODNet at 15.6 s/frame).

**Acceptance test (gates the phase, on a real webcam + GPU):** still pose, head turn, arms up, fast hand wave, move toward/away. Pass if edges are calm, limbs stay attached, room chunks are limited, Blur has no artifacts; targets 30 fps output, ≥ 24 masks/s, 720p minimum (1080p only when sustained). Compare `modnet` vs `mediapipe` (and `rvm` in dev) with the readout's backend, infer ms, masks/s, draw ms, fps, flicker, fallbacks.

**Decision after evaluation:** RVM much better on motion → legal review / permissive recurrent alternative / flow-based propagation on MODNet (Phase 2). RVM only slightly better → stay on MODNet.

### Normalized metric (supersedes the raw-flicker table above)
The first flicker metric penalized MODNet's genuinely wider soft edge. Now: every model's alpha resampled to 384×216; flicker measured only inside a fixed ±3 px band around the 0.5 contour of each frame pair (same geometric band for every model); reported as mean |Δα| in the band and as **edge shift** (Σ|Δα| in the band ÷ contour length ≈ pixels the edge moves per frame). 48 frames per clip.

| noisy still clip (edge shift px/frame) | raw | stabilized |
|---|---|---|
| MediaPipe | 0.317 | 0.173 |
| MODNet | 0.218 (31% calmer) | 0.188 |
| RVM (recurrent) | 0.185 (42% calmer) | **0.068** (≈ 2.5× calmer) |

On the fast-motion clip all three move ≈ 4.5–5.3 px/frame (real motion dominates; the metric doesn't separate it). Findings: recurrence matters — RVM's frame-to-frame noise is small and consistent, so the stabilizer absorbs it; MODNet's raw output is calmer than MediaPipe's but its noise passes through our stabilizer more (stabilized ≈ MediaPipe) — a per-source stabilizer tuning is a candidate. MODNet's lasting advantage is shape (no room chunks). Speed on real GPUs is the open gate: if typical laptops fail the 24 masks/s check, most users stay on MediaPipe.

### First-use download UX (progressive upgrade)
`auto` starts on MediaPipe immediately (Record usable in ~0.3 s), then loads MODNet in the background — model + runtime fetched with byte progress (shown as "Sharper edges loading… N%"), handed to ORT (`env.wasm.wasmBinary`, no second download). Devices without WebGPU never download it. When it passes the speed gate it becomes the current source: **framing compositors switch to it; a recording keeps the source it started with**; the next framing view uses the upgrade. Explicit `8080.vbg-source` values load that engine directly (clean evaluation runs).

## Pre-merge hardening (2026-10-04)

### Model provenance
- Pinned source: Hugging Face `Xenova/modnet`, revision `fa2fa546052fba4c08921230a26cc69a333fca12`, file `onnx/model.onnx`, **SHA-256 `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`**, 25,888,640 bytes.
- **Byte-identical to the official ZHKKKe export:** the official repository (github.com/ZHKKKe/MODNet, `onnx/README.md`) links "the ONNX version of the official Image Matting Model" on Google Drive (file id `1cgycTQlYXpTh26gB9FTnthE7AvruV8hd`); downloaded and compared with `cmp` — same bytes, same SHA-256. The official repository states its code, models and demos are Apache-2.0 (excluding GIFs under `doc/gif`). The Hugging Face copy is a mirror of that file, not a re-trained or re-licensed model; it's used for a stable pinned download.

### Build and caching
- The model fetch **fails the build** in CI and on Railway (`CI`, `RAILWAY_ENVIRONMENT`/`RAILWAY_ENVIRONMENT_NAME`, or `VBG_REQUIRE_MODEL=1`); local builds warn and continue (MediaPipe only). Verified offline (no network namespace): `CI=1` → build error from `modnet-model`; local → warning, build succeeds.
- Runtime assets live at versioned URLs — `/vendor/mediapipe-<version>/`, `/vendor/ort-<version>/`, `/models/modnet-<sha12>.onnx` — injected into the app as `__VBG_ASSETS__` (one source of truth). Production (`vite preview`, the `long-cache` plugin) serves them and Vite's hashed `/assets/` with `Cache-Control: public, max-age=31536000, immutable`; `index.html` and unversioned files stay `no-cache`. Verified with curl on a production build.

### Per-source stabilizer tuning
Stillness noise alone can be gamed by lagging, so every setting was also scored for **lag** (mean |stabilized − raw| in a ±3 px band around the current raw contour) on a fast clip (~5 px/frame) and a slow clip (~1 px/frame — where smoothing could trail). Kept only if slow-motion lag rose ≤ ~3%.

| | still edge shift (px/frame) | slow lag |
|---|---|---|
| MediaPipe default | 0.173 | 15.59 |
| **MediaPipe floor 1, keep 0.85** (shipped) | **0.058 (−66%)** | 16.09 (+3%) |
| MODNet default | 0.188 | 2.80 |
| **MODNet floor 0.8, threshold 0.5** (shipped) | **0.160 (−15%)** | 2.88 (+3%) |
| MODNet floor 1, threshold 0.5, keep 0.85 | 0.149 (−21%) | 2.93 (+5%) — rejected |
| MODNet + 3-frame temporal median | 0.042 | fast lag 39% (vs 2.8%) — rejected |

The missing piece was a certainty **floor**: smoothing was weighted by certainty, and edge pixels sit near 0.5 (certainty ≈ 0), so the edge — where flicker lives — was never smoothed. MODNet improves less because its noise moves the edge by a pixel or more for several frames, indistinguishable from small real motion without a delay. Fast-clip lag was flat for every setting (all moving pixels exceed the threshold), so the slow clip is the real lag check; the acceptance test's fast-hand and arms-up steps remain the final word (watch for edges trailing behind hands, not just clipping).

### Acceptance test additions
Per machine (including a weak laptop), record: backend, infer ms, masks/s, and whether MODNet passed the 24 masks/s gate (`fallback` line says why not). Run MODNet once with the gate off (dev build: `localStorage['8080.vbg-nogate']='1'` + `8080.vbg-source='modnet'`): if it manages 15–20 masks/s and still looks better than MediaPipe at 30, the gate is too strict and is sending users to the worse engine. Test the real mid-recording swap on a GPU machine (here it ran with a stand-in source).

## Merge gate: real-device acceptance (agreed 2026-10-04)
Run on a **strong GPU desktop, a normal laptop and a weak laptop**, in every target browser (Firefox and Chromium). Readout on: `localStorage['8080.vbg-debug']='1'`. Compare engines with `localStorage['8080.vbg-source']` = `'modnet'` vs `'mediapipe'` (reload between).

| # | Check | Record |
|---|---|---|
| 1 | Edge calmness sitting still, MODNet vs MediaPipe | `edge … flicker` + what you see |
| 2 | Hands/arms retained during fast movement (and not trailing behind hands) | pass/fail per engine |
| 3 | Hair / headphones / face edge quality | notes per engine |
| 4 | Backend and speed | `backend`, `infer` ms, masks/s; did MODNet pass the 24 masks/s gate (else the `fallback` line) |
| 5 | Does the quality ladder fall back during framing | `canvas`, `tier`, `polish`, `blur` lines over ~1 min |
| 6 | Recording stays on the engine it started with, incl. a real upgrade landing mid-take (`auto`, start recording during "Sharper edges loading…") | backend before / during / after |
| 7 | First-use load vs cached revisit | seconds to "ready" and to MODNet, cold vs warm |
| 8 | Firefox vs Chromium | all of the above per browser |

How to read the rows:
- **Firefox is mostly a fallback/compatibility check.** Its WebGPU support is partial and varies by platform, so many Firefox runs will land on MediaPipe. Record those as fallback behaviour (the `fallback` line says why), not as MODNet results.
- **Safari: add a row if Mac users matter.** Recent Safari versions support WebGPU, and Apple GPUs may perform very differently from the Windows laptops.
- **The weak laptop is the deciding row.** It shows whether MODNet is actually the default path for most users, or whether they mostly stay on MediaPipe.

Plus once per machine: MODNet with the gate off (dev build, `8080.vbg-nogate='1'`) — if it manages 15–20 masks/s and still looks better than MediaPipe, the 40 ms gate is too strict.

**No stabilizer tuning before these results.** If MODNet clearly beats MediaPipe on real hardware without falling below a usable frame rate: merge PR #3 and **freeze this phase**. Consider the next quality step (worker inference, flow propagation, recurrent matting) only if the test still shows obvious temporal instability.
