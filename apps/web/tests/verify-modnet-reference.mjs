import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const jsonPath = path.resolve('/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json')
const jsonPathWin = 'C:\\Users\\Administrator\\Downloads\\vbg-synchronized-frame.json'
const fileToUse = fs.existsSync(jsonPath) ? jsonPath : jsonPathWin

const diagData = JSON.parse(fs.readFileSync(fileToUse, 'utf8'))

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

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })

  const res = await page.evaluate(async (diag) => {
    const { loadOrt, toChw } = await import('/src/features/vbg/ort.ts')
    const ort = await loadOrt()
    
    const response = await fetch(__VBG_ASSETS__.modnet)
    const modelArrayBuffer = await response.arrayBuffer()
    const sessionCpu = await ort.InferenceSession.create(modelArrayBuffer, { executionProviders: ['wasm'] })

    const inputName = sessionCpu.inputNames[0]
    const outputName = sessionCpu.outputNames[0]

    // Load both original camera image and inferenceInput image
    const origImg = new Image()
    origImg.src = diag.original
    await new Promise((resolve) => (origImg.onload = resolve))

    const infImg = new Image()
    infImg.src = diag.inferenceInput
    await new Promise((resolve) => (infImg.onload = resolve))

    const runResolution = async (imgSource, targetW, targetH) => {
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(imgSource, 0, 0, targetW, targetH)

      const chw = toChw(canvas, 2 / 255, -1)
      const tensor = new ort.Tensor('float32', chw, [1, 3, targetH, targetW])
      const res = await sessionCpu.run({ [inputName]: tensor })
      const out = res[outputName].data
      
      // Sample 4 key locations proportionally:
      // Upper face ~ (50% x, 31% y)
      // Mid face / nose ~ (50% x, 42% y)
      // Jaw ~ (50% x, 51% y)
      // Shirt ~ (50% x, 80% y)
      // Background ~ (13% x, 45% y)
      const sampleAt = (rx, ry) => {
        const x = Math.round(rx * targetW)
        const y = Math.round(ry * targetH)
        const idx = y * targetW + x
        return out[idx]
      }

      return {
        targetW, targetH,
        upperFace: sampleAt(0.50, 0.31),
        midFace: sampleAt(0.50, 0.42),
        jaw: sampleAt(0.50, 0.51),
        shirt: sampleAt(0.50, 0.80),
        bgLeft: sampleAt(0.13, 0.45),
      }
    }

    const test384 = await runResolution(origImg, 384, 224)
    const test512 = await runResolution(origImg, 512, 288)
    const test640 = await runResolution(origImg, 640, 384)

    return { test384, test512, test640 }
  }, diagData)

  console.log('--- Multi-Resolution Reference ONNX Output Comparison ---')
  console.log('Resolution | Upper Face | Mid Face | Jaw | Shirt | BG Left')
  console.log('-----------------------------------------------------------')
  console.log(`384×224    | ${res.test384.upperFace.toFixed(6)} | ${res.test384.midFace.toFixed(6)} | ${res.test384.jaw.toFixed(6)} | ${res.test384.shirt.toFixed(6)} | ${res.test384.bgLeft.toFixed(6)}`)
  console.log(`512×288    | ${res.test512.upperFace.toFixed(6)} | ${res.test512.midFace.toFixed(6)} | ${res.test512.jaw.toFixed(6)} | ${res.test512.shirt.toFixed(6)} | ${res.test512.bgLeft.toFixed(6)}`)
  console.log(`640×384    | ${res.test640.upperFace.toFixed(6)} | ${res.test640.midFace.toFixed(6)} | ${res.test640.jaw.toFixed(6)} | ${res.test640.shirt.toFixed(6)} | ${res.test640.bgLeft.toFixed(6)}`)

} finally {
  await browser.close()
}
