# Virtual background quality evaluation

Implemented: WebGL2 joint-bilateral upsampling, using a camera snapshot paired
with each inference. It refines the stabilized mask using full-resolution RGB,
then copies its output for subsequent camera frames. Confident interior alpha is
preserved. No full-resolution JavaScript pixel loop is used. This is a classical
RGB-guided filter, not Teams' learned deep guided filter or a recurrent model.
Unsupported/lost WebGL contexts fall back to the stabilized Canvas mask. Refinement
shares the existing adaptive polish budget and is disabled when polish is off.

MODNet now benchmarks 512, 384 and 256 pixel widths in that order and selects the
first meeting the existing 40 ms budget. Debug output separates CPU preprocessing
from session execution plus CPU output readback. Those times alone cannot separate
GPU kernel time from scheduling/readback; use ORT profiling for that investigation.
Probe timing is at 16:9, so verify actual camera aspect ratios and sustained load.
Smaller input may fit the device but is not automatically better than MediaPipe.

## Automated checks

`pnpm --filter web test:vbg` checks synthetic head loss/recovery and sustained
absence at multiple inference rates, plus actual Chromium shader execution,
orientation, RGB-edge accuracy, output resizing and context-loss fallback.
The RGB-edge fixture is deliberately simple; its error reduction is not a webcam
quality benchmark. `pnpm --filter web build` checks the production bundle.

## Real-video acceptance still required

Use identical recorded frames for comparisons, with the same output resolution:

- Dark hair against a dark background, headphones, glasses, low light/noise.
- Still subject for 30 seconds, slow head turns, leaning, fast lateral movement.
- Hands crossing the face, leaving frame, returning, and background motion.
- Compare MediaPipe, each viable MODNet size, and the development-only RVM baseline.
- Record head-region loss, mask-area change, edge flicker, motion trails, sustained
  frame rate, inference breakdown, refinement cost and active fallback reason.

Enable the readout with localStorage['8080.vbg-debug'] = '1'. Existing
'8080.vbg-source' overrides select 'mediapipe' or 'modnet'; development also allows
'rvm' when its evaluation weights are installed. '8080.vbg-tune' with
{"polish":false} disables refinement and other polish, so it is not an isolated
refiner-only A/B. The automated shader test isolates the refinement itself.

## Remaining architectural work

Production MODNet and MediaPipe still have no recurrent model state. The RVM
experiment is GPL-3.0 and development-only; production adoption requires an
appropriate distribution/license decision or a separately licensed model.
Its source is cached globally, so recurrent state also needs per-stream ownership
and reset semantics before concurrent production use. A guided filter cannot
reconstruct a head missing entirely from the source mask. Existing bounded
foreground persistence mitigates brief dropouts, but is not model-level memory.

Noise-aware inference preprocessing and scene adaptation have not been enabled:
validate them on dark/noisy clips first so preprocessing does not erase hair
features. Keep the original camera pixels for compositing in any experiment.

References:
- https://www.microsoft.com/en-us/research/publication/person-segmentation-in-teams/
- https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html
- https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html

## Head disappearance capture lab (development)

Open http://localhost:5173/vbg-lab.html with the existing web dev server running.
The page is a separate development entry and is not included in the production
build. It imports the production compositor with an explicit offline evaluation
mode; it does not change live segmentation thresholds or select a new model.

1. Start the camera and record 10–20 seconds in the same difficult lighting.
   Start still, turn/lean, then return. The lab records the original video track,
   without effects or audio, at a requested 1080p/30 fps and 12 Mbps. Actual camera
   resolution/rate depends on the device. Download the original and preserve it.
2. Pause and draw a rectangle entirely inside the visible head on the annotation
   canvas. Add annotations at the first and last test frames, and wherever motion
   changes. Interpolated rectangles must remain inside the head, not background.
3. Set a valid clip interval, use 30 samples/s, and compare all three backends.
   MODNet and RVM require WebGPU. RVM weights are already installed locally under
   `.dev-models/`; it remains development-only. Unavailable models are reported,
   never substituted. The normal MODNet speed gate still applies.
4. Download the JSON report and current five-stage PNG. The report includes up to
   20 failure contact sheets per backend, annotations, per-frame stage measurements,
   exact requested media timestamps, input frame hashes, inference times and browser
   details. Hash mismatch stops a backend run. Seek-based sampling is deterministic
   across backends but is not an exhaustive decode of every native camera frame.
5. Keep the raw clip, report and snapshots together outside source control. To
   reproduce a result, reopen the exact raw file and reuse the reported annotations
   and interval. The current UI requires re-entering annotations from the report.

The five stages use one immutable camera snapshot per inference. The final panel
is rendered by the app's real compositor using that snapshot and those masks.
Offline stabilizer time advances with media timestamps, not inference wall time;
each backend starts with isolated history and an independently created model.
Inference duration excludes seek/decode, hashing, metric readback and rendering.
Offline timings are not sustained live FPS. Automatic frame-budget degradation
and automatic backend switching are deliberately absent during the controlled
comparison, so this experiment does not certify live switching behavior.

A significant automated head-core dropout means <90% foreground coverage in the
annotated head rectangle for >=100ms of consecutive samples. Missing annotations,
failed/cancelled runs and sampling below 30Hz cannot pass this automated check.
It is a diagnostic proxy, not ground-truth segmentation accuracy. Edge-change
metrics include real motion and must be compared on identical frames. Motion lag,
hair boundary loss and final composite integrity require visual review. Overall
acceptance remains zero significant head dropouts; a passing head-core check alone
is not acceptance. Shorter-than-sample-interval events can be missed.

### Existing failure reference

User-supplied media `cmv0zidxm00h65j6puesfboe7` resolves locally to
`apps/server/uploads/a3223199-7eec-466f-91cd-431643dbdebf.webm`.
Inspected: 1920×1080 VP8 + Opus, 14,758,566 bytes, last video packet at 9.951s.
The inspected frame already contains the replacement background. Use this as a
failure reference, not as raw model input: lost camera pixels and original masks
cannot be recovered. The app's normal effect-enabled recorder stores the
compositor's video track, not a parallel raw recording. Signed playback URLs
expire; preserve the file path/media ID rather than its token.

Validation: `pnpm --filter web test:vbg-capture` (dev server on port 5173) exercises
raw camera recording and actual compositor evaluation in Chromium, including an
input mutation during asynchronous inference, timestamp propagation and decay
using media time. `pnpm --filter web test:vbg` runs the mask and shader checks.
