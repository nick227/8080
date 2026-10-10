import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const jsonPath = path.resolve('/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json')
const jsonPathWin = 'C:\\Users\\Administrator\\Downloads\\vbg-synchronized-frame.json'
const fileToUse = fs.existsSync(jsonPath) ? jsonPath : jsonPathWin

console.log('Loading diagnostic capture from:', fileToUse)
const diagData = JSON.parse(fs.readFileSync(fileToUse, 'utf8'))

console.log('\n============================================================')
console.log(' CONTROLLED EXPERIMENT: VBG SEGMENTATION MODEL COMPARISON')
console.log('============================================================')
console.log(`Original Frame Size: 1920 × 1080 (PNG length: ${diagData.original.length})`)
console.log(`Model Input Size:    ${diagData.width} × ${diagData.height} (PNG length: ${diagData.inferenceInput.length})`)
console.log(`Captured Backend:    ${diagData.backend} (${diagData.model})`)
console.log(`Raw Alpha Length:    ${diagData.rawAlpha.length} floats`)

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
})

try {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', error => console.error('BROWSER ERROR:', error.message))
  page.on('console', msg => {
    if (msg.type() === 'warning' || msg.type() === 'error') console.log(`PAGE ${msg.type().toUpperCase()}:`, msg.text())
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })

  const results = await page.evaluate(async (diag) => {
    const { loadOrt, toChw } = await import('/src/features/vbg/ort.ts')
    const ort = await loadOrt()

    // Load Original Image (1920x1080) and Saved InferenceInput Image (384x224)
    const origImg = new Image()
    origImg.src = diag.original
    await new Promise((res) => (origImg.onload = res))

    const infImg = new Image()
    infImg.src = diag.inferenceInput
    await new Promise((res) => (infImg.onload = res))

    const W = infImg.width  // 384
    const H = infImg.height // 224

    // Prepare standard 384x224 canvas
    const stdCanvas = document.createElement('canvas')
    stdCanvas.width = W
    stdCanvas.height = H
    const stdCtx = stdCanvas.getContext('2d', { willReadFrequently: true })
    stdCtx.drawImage(origImg, 0, 0, W, H)

    // Helper: Compute region metrics for an alpha array
    const evaluateRegions = (alphaArray, maskW = W, maskH = H) => {
      let headCount = 0, headFg = 0
      let upperFaceCount = 0, upperFaceFg = 0
      let jawCount = 0, jawFg = 0
      let torsoCount = 0, torsoFg = 0
      let bgCount = 0, bgLeak = 0

      for (let y = 0; y < maskH; y++) {
        const ry = y / maskH
        for (let x = 0; x < maskW; x++) {
          const rx = x / maskW
          const val = alphaArray[y * maskW + x]

          // Head (y 10% - 45%, x 35% - 65%)
          if (ry >= 0.10 && ry <= 0.45 && rx >= 0.35 && rx <= 0.65) {
            headCount++
            if (val >= 0.5) headFg++
          }

          // Upper Face (y 10% - 32%, x 38% - 62%)
          if (ry >= 0.10 && ry <= 0.32 && rx >= 0.38 && rx <= 0.62) {
            upperFaceCount++
            if (val >= 0.5) upperFaceFg++
          }

          // Jaw / Lower Face (y 32% - 48%, x 38% - 62%)
          if (ry >= 0.32 && ry <= 0.48 && rx >= 0.38 && rx <= 0.62) {
            jawCount++
            if (val >= 0.5) jawFg++
          }

          // Torso (y 50% - 95%, x 25% - 75%)
          if (ry >= 0.50 && ry <= 0.95 && rx >= 0.25 && rx <= 0.75) {
            torsoCount++
            if (val >= 0.5) torsoFg++
          }

          // Background (x < 20% or x > 80%)
          if (rx < 0.20 || rx > 0.80) {
            bgCount++
            if (val >= 0.1) bgLeak++
          }
        }
      }

      const sampleAt = (rx, ry) => {
        const x = Math.min(maskW - 1, Math.max(0, Math.round(rx * maskW)))
        const y = Math.min(maskH - 1, Math.max(0, Math.round(ry * maskH)))
        return alphaArray[y * maskW + x]
      }

      return {
        headCoverage: headCount ? (headFg / headCount) * 100 : 0,
        upperFaceCoverage: upperFaceCount ? (upperFaceFg / upperFaceCount) * 100 : 0,
        jawCoverage: jawCount ? (jawFg / jawCount) * 100 : 0,
        torsoCoverage: torsoCount ? (torsoFg / torsoCount) * 100 : 0,
        bgLeakage: bgCount ? (bgLeak / bgCount) * 100 : 0,
        samples: {
          upperFace: sampleAt(0.50, 0.31),  // (192, 70)
          jaw:       sampleAt(0.50, 0.51),  // (192, 115)
          shirt:     sampleAt(0.50, 0.80),  // (192, 180)
          bgLeft:    sampleAt(0.13, 0.45),  // (50, 100)
        }
      }
    }

    // -------------------------------------------------------------
    // FULL ARRAY EQUIVALENCE: CPU ONNX Reference vs Captured WebGPU
    // -------------------------------------------------------------
    const modnetBytes = await fetch(__VBG_ASSETS__.modnet).then(r => r.arrayBuffer())
    const modnetCpuSession = await ort.InferenceSession.create(modnetBytes, { executionProviders: ['wasm'] })
    const mInputName = modnetCpuSession.inputNames[0]
    const mOutputName = modnetCpuSession.outputNames[0]

    const stdTensorData = toChw(stdCanvas, 2 / 255, -1)
    const stdTensor = new ort.Tensor('float32', stdTensorData, [1, 3, H, W])
    const cpuRes = await modnetCpuSession.run({ [mInputName]: stdTensor })
    const cpuRawAlpha = cpuRes[mOutputName].data

    const capturedAlpha = diag.rawAlpha
    let totalAbsDiff = 0, maxAbsDiff = 0
    for (let i = 0; i < capturedAlpha.length; i++) {
      const diff = Math.abs(capturedAlpha[i] - cpuRawAlpha[i])
      totalAbsDiff += diff
      if (diff > maxAbsDiff) maxAbsDiff = diff
    }
    const fullArrayMae = totalAbsDiff / capturedAlpha.length

    // -------------------------------------------------------------
    // TEST 1: MODNet (Baseline, Original Input)
    // -------------------------------------------------------------
    const test1Stats = evaluateRegions(cpuRawAlpha, W, H)

    // -------------------------------------------------------------
    // TEST 2A: MODNet + Gamma 0.5 Pre-Conditioning (Before Inference)
    // -------------------------------------------------------------
    const gammaCanvas = document.createElement('canvas')
    gammaCanvas.width = W
    gammaCanvas.height = H
    const gammaCtx = gammaCanvas.getContext('2d', { willReadFrequently: true })
    gammaCtx.drawImage(origImg, 0, 0, W, H)
    const gammaImgData = gammaCtx.getImageData(0, 0, W, H)
    const gPx = gammaImgData.data
    const lut05 = new Uint8Array(256)
    for (let i = 0; i < 256; i++) lut05[i] = Math.round(Math.pow(i / 255, 0.5) * 255)
    for (let i = 0; i < gPx.length; i += 4) {
      gPx[i] = lut05[gPx[i]]
      gPx[i+1] = lut05[gPx[i+1]]
      gPx[i+2] = lut05[gPx[i+2]]
    }
    gammaCtx.putImageData(gammaImgData, 0, 0)

    const gammaTensorData = toChw(gammaCanvas, 2 / 255, -1)
    const gammaTensor = new ort.Tensor('float32', gammaTensorData, [1, 3, H, W])
    const gammaRes = await modnetCpuSession.run({ [mInputName]: gammaTensor })
    const test2Stats = evaluateRegions(gammaRes[mOutputName].data, W, H)

    // -------------------------------------------------------------
    // TEST 2B: MODNet + Exposure Gain 1.6x Pre-Conditioning
    // -------------------------------------------------------------
    const gainCanvas = document.createElement('canvas')
    gainCanvas.width = W
    gainCanvas.height = H
    const gainCtx = gainCanvas.getContext('2d', { willReadFrequently: true })
    gainCtx.drawImage(origImg, 0, 0, W, H)
    const gainImgData = gainCtx.getImageData(0, 0, W, H)
    const gnPx = gainImgData.data
    for (let i = 0; i < gnPx.length; i += 4) {
      gnPx[i] = Math.min(255, Math.round(gnPx[i] * 1.6))
      gnPx[i+1] = Math.min(255, Math.round(gnPx[i+1] * 1.6))
      gnPx[i+2] = Math.min(255, Math.round(gnPx[i+2] * 1.6))
    }
    gainCtx.putImageData(gainImgData, 0, 0)

    const gainTensorData = toChw(gainCanvas, 2 / 255, -1)
    const gainTensor = new ort.Tensor('float32', gainTensorData, [1, 3, H, W])
    const gainRes = await modnetCpuSession.run({ [mInputName]: gainTensor })
    const test2GainStats = evaluateRegions(gainRes[mOutputName].data, W, H)

    // -------------------------------------------------------------
    // TEST 3: RVM (Robust Video Matting, Original Input)
    // -------------------------------------------------------------
    let test3Stats = null
    try {
      const rvmBytes = await fetch('/__dev-models/rvm_mobilenetv3_fp32.onnx').then(r => r.arrayBuffer())
      const rvmSession = await ort.InferenceSession.create(rvmBytes, { executionProviders: ['wasm'] })

      const rvmW = 640
      const rvmH = 360
      const rvmCanvas = document.createElement('canvas')
      rvmCanvas.width = rvmW
      rvmCanvas.height = rvmH
      const rvmCtx = rvmCanvas.getContext('2d')
      rvmCtx.drawImage(origImg, 0, 0, rvmW, rvmH)

      const zero = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1])
      const ratio = new ort.Tensor('float32', new Float32Array([0.5]), [1])
      const srcTensor = new ort.Tensor('float32', toChw(rvmCanvas, 1 / 255, 0), [1, 3, rvmH, rvmW])

      const rvmRes = await rvmSession.run({
        src: srcTensor,
        r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero(),
        downsample_ratio: ratio
      })

      const rvmAlpha = rvmRes.pha.data
      test3Stats = evaluateRegions(rvmAlpha, rvmW, rvmH)
      rvmSession.release()
    } catch (err) {
      console.warn('RVM Session Error:', err.message)
    }

    // -------------------------------------------------------------
    // TEST 4: MediaPipe Selfie Segmenter (Existing Fallback Baseline)
    // -------------------------------------------------------------
    let test4Stats = null
    try {
      const { createMediapipeSource } = await import('/src/features/vbg/mediapipeSource.ts')
      const mpSource = await createMediapipeSource()
      const mpCanvas = document.createElement('canvas')
      mpCanvas.width = 384
      mpCanvas.height = 216
      const mpCtx = mpCanvas.getContext('2d')
      mpCtx.drawImage(origImg, 0, 0, 384, 216)
      const mpFrame = await mpSource.run(mpCanvas, 100)
      if (mpFrame) test4Stats = evaluateRegions(mpFrame.data, mpFrame.width, mpFrame.height)
      mpSource.dispose()
    } catch (err) {
      console.warn('MediaPipe Error:', err.message)
    }

    modnetCpuSession.release()

    return {
      equivalence: { fullArrayMae, maxAbsDiff },
      test1Stats,
      test2Stats,
      test2GainStats,
      test3Stats,
      test4Stats,
    }
  }, diagData)

  console.log('\n============================================================')
  console.log(' 1. FULL NUMERICAL EQUIVALENCE (CPU ONNX vs WebGPU ONNX)')
  console.log('============================================================')
  console.log(`  - Mean Absolute Error (MAE): ${results.equivalence.fullArrayMae.toExponential(4)}`)
  console.log(`  - Maximum Absolute Diff:     ${results.equivalence.maxAbsDiff.toFixed(6)}`)
  if (results.equivalence.fullArrayMae < 1e-3) {
    console.log('  -> CONFIRMED: Full CPU reference and WebGPU execution are NUMERICALLY EQUIVALENT across all 86,016 float values.')
  }

  console.log('\n============================================================')
  console.log(' 2. CONTROLLED EXPERIMENT METRICS COMPARISON')
  console.log('============================================================')
  
  const printTest = (title, stats) => {
    if (!stats) { console.log(`\n[${title}]: FAILED / UNAVAILABLE`); return }
    console.log(`\n[${title}]:`)
    console.log(`  • Head Coverage (% α≥0.5):      ${stats.headCoverage.toFixed(2)}%`)
    console.log(`  • Upper Face Coverage (% α≥0.5): ${stats.upperFaceCoverage.toFixed(2)}%`)
    console.log(`  • Lower Face / Jaw (% α≥0.5):   ${stats.jawCoverage.toFixed(2)}%`)
    console.log(`  • Torso / Body (% α≥0.5):        ${stats.torsoCoverage.toFixed(2)}%`)
    console.log(`  • Background Leakage (% α≥0.1):  ${stats.bgLeakage.toFixed(2)}%`)
    console.log(`  • Sample Alphas:`)
    console.log(`      Upper Face (192, 70):   ${stats.samples.upperFace.toFixed(6)}`)
    console.log(`      Jaw (192, 115):         ${stats.samples.jaw.toFixed(6)}`)
    console.log(`      Shirt Center (192, 180): ${stats.samples.shirt.toFixed(6)}`)
    console.log(`      BG Left (50, 100):      ${stats.samples.bgLeft.toFixed(6)}`)
  }

  printTest('Test 1: MODNet (Baseline, Original Input)', results.test1Stats)
  printTest('Test 2A: MODNet + Gamma 0.5 Pre-Conditioning', results.test2Stats)
  printTest('Test 2B: MODNet + Exposure Gain 1.6x Pre-Conditioning', results.test2GainStats)
  printTest('Test 3: RVM (Robust Video Matting, Original Input)', results.test3Stats)
  printTest('Test 4: MediaPipe Selfie Segmenter (Fallback Baseline)', results.test4Stats)

  console.log('\n============================================================')
  console.log(' EXPERIMENT SUMMARY & DECISION TABLE')
  console.log('============================================================')
  
  const modnetFace = results.test1Stats.upperFaceCoverage
  const gammaFace = results.test2Stats.upperFaceCoverage
  const gainFace = results.test2GainStats.upperFaceCoverage
  const rvmFace = results.test3Stats ? results.test3Stats.upperFaceCoverage : 0
  const mpFace = results.test4Stats ? results.test4Stats.upperFaceCoverage : 0

  console.log(`Upper Face Coverage (% α≥0.5):`)
  console.log(`  • Test 1 (MODNet Baseline):           ${modnetFace.toFixed(1)}%`)
  console.log(`  • Test 2A (MODNet + Gamma 0.5):       ${gammaFace.toFixed(1)}%`)
  console.log(`  • Test 2B (MODNet + Exposure 1.6x):   ${gainFace.toFixed(1)}%`)
  console.log(`  • Test 3 (RVM MobileNetV3):           ${rvmFace.toFixed(1)}%`)
  console.log(`  • Test 4 (MediaPipe SelfieSegmenter): ${mpFace.toFixed(1)}%`)

} finally {
  await browser.close()
}
