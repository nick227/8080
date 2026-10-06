import { loadStyles } from './style-utils.mjs'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const css = await loadStyles()
// Catch unresolved CSS variables and accidental palette literals in feature CSS.
const collectCss = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? collectCss(url) : entry.name.endsWith('.css') ? readFile(url, 'utf8') : ''
  }))).flat()
}
const featureCss = await collectCss(new URL('../src/features/', import.meta.url))
const allCss = [css, ...featureCss].join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]))
// These grid dimensions are supplied by component inline styles.
const componentVariables = new Set(['--rows', '--columns'])
for (const [, name] of allCss.matchAll(/var\((--[\w-]+)/g)) {
  assert.ok(defined.has(name) || componentVariables.has(name), `Undefined CSS variable: ${name}`)
}
for (const sheet of featureCss) {
  assert.doesNotMatch(sheet.replace(/\/\*[\s\S]*?\*\//g, ''), /#[\da-f]{3,8}\b|rgba?\(/i)
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<style>${css}
    .hover { background: var(--surface-hover); }
    .alias { background: var(--bg-elevated); color: var(--surface-sunken); }
  </style>
  <div id="outer" data-theme="light">
    <div id="hover" class="hover"></div>
    <div id="alias" class="alias"></div>
    <div id="inner" data-theme="dark"><div id="inner-hover" class="hover"></div></div>
  </div>`)
  const style = (selector, property) => page.locator(selector).evaluate((el, property) =>
    getComputedStyle(el).getPropertyValue(property).trim(), property)
  assert.equal(await style('body', 'background-color'), 'rgb(15, 17, 21)')
  assert.equal(await style('#outer', 'background-color'), 'rgb(245, 244, 239)')
  assert.equal(await style('#inner', 'background-color'), 'rgb(15, 17, 21)')
  assert.equal(await style('#outer', 'color-scheme'), 'light')
  assert.equal(await style('#inner', 'color-scheme'), 'dark')
  assert.equal(await style('#alias', 'background-color'), 'rgb(255, 255, 255)')
  assert.equal(await style('#alias', 'color'), 'rgb(233, 233, 226)')
  const darkHover = await style('#inner-hover', 'background-color')
  assert.notEqual(await style('#hover', 'background-color'), darkHover)

  await page.locator('#outer').evaluate(el => el.style.setProperty('--ink', '#ff0000'))
  const redHover = await style('#hover', 'background-color')
  assert.match(redHover, /color\(srgb 1 0 0 \/ 0\.04\)/)
  assert.equal(await style('#inner-hover', 'background-color'), darkHover)
  await page.locator('#outer').evaluate(el => el.style.setProperty('--surface-hover', '#123456'))
  assert.equal(await style('#hover', 'background-color'), 'rgb(18, 52, 86)')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  assert.equal(await style('body', 'background-color'), 'rgb(245, 244, 239)')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  assert.equal(await style('body', 'background-color'), 'rgb(15, 17, 21)')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await style('html', '--motion-base'), '0ms')
  assert.equal(await style('#inner', '--motion-pulse'), '0ms')
  // Exercise real feature selectors, not just token definitions.
  const features = (await Promise.all(['work/work.css', 'calendar/calendar.css', 'room/choices.css']
    .map(name => readFile(new URL(`../src/features/${name}`, import.meta.url), 'utf8')))).join('\n')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setContent(`<style>${css} ${features}</style>
    <section id="density" data-theme="light" data-density="comfortable" style="--sans: monospace">
      <nav class="work-nav"></nav>
      <div class="work-bar"></div>
      <button class="cal-btn">Today</button>
      <div class="cal-field"><input value="Calendar input"></div>
      <div class="room-choice-options"><button>Choose</button></div>
      <button class="record-button">Record</button>
      <button class="sub-control">Mic</button>
      <table class="docs-table"><thead><tr><th>Title</th></tr></thead><tbody><tr><td>Document</td></tr></tbody></table>
      <div id="nested" data-density="spacious"><nav class="work-nav"></nav></div>
      <div id="nested-theme" data-theme="dark"><nav class="work-nav"></nav></div>
    </section>`)
  assert.equal(await style('#density > .work-nav', 'height'), '36px')
  assert.equal(await style('#density > .work-nav', 'padding-left'), '24px')
  assert.equal(await style('.docs-table td', 'height'), '36px')
  assert.equal(await style('.docs-table th', 'height'), '32px')
  assert.equal(await style('.record-button', 'width'), '120px')
  assert.equal(await style('.cal-field input', 'color-scheme'), 'light')
  assert.equal(await style('#nested', 'color'), 'rgb(32, 33, 39)')
  assert.equal(await style('#nested', 'font-family'), 'monospace')
  const near = (actual, expected) => assert.ok(Math.abs(parseFloat(actual) - expected) < 0.1, `${actual} != ${expected}`)
  near(await style('#nested .work-nav', 'height'), 43.2)
  await page.locator('#density').evaluate(el => { el.dataset.density = 'compact' })
  assert.equal(await style('#density > .work-nav', 'height'), '32px')
  near(await style('#density > .work-nav', 'padding-left'), 19.2)
  near(await style('.docs-table td', 'height'), 28.8)
  assert.equal(await style('.docs-table th', 'height'), '28px')
  assert.equal(await style('.cal-btn', 'height'), '24px')
  assert.equal(await style('.cal-field input', 'height'), '28px')
  assert.equal(await style('.sub-control', 'width'), '44px')
  near(await style('.record-button', 'width'), 96)
  assert.equal(await style('#nested-theme .work-nav', 'height'), '32px')
  near(await style('#nested .work-nav', 'height'), 43.2)
  await page.locator('#density').evaluate(el => {
    el.style.setProperty('--density', '0.1')
    el.style.setProperty('--table-row-height', '50px')
    el.style.setProperty('--toolbar-padding-x', '23px')
  })
  assert.equal(await style('.record-button', 'width'), '90px')
  assert.equal(await style('.docs-table td', 'height'), '50px')
  assert.equal(await style('#density > .work-nav', 'padding-left'), '23px')
  await page.setViewportSize({ width: 600, height: 800 })
  assert.equal(await style('.record-button', 'width'), '88px')
  const responseCss = await readFile(new URL('../src/features/responseMap.css', import.meta.url), 'utf8')
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.setContent(`<style>${css} ${features} ${responseCss}</style>
    <section data-theme="light" data-density="spacious" style="width:600px; --weight-medium:600; --leading-body:1.8; --focus-color:rgb(0,128,0); --opacity-disabled:0.6">
      <div class="response-row"><div class="response-card">One</div><div class="response-card">Two</div><div class="response-card">Three</div></div>
      <div class="response-fallback">Media label</div>
      <div class="cal-title">Title</div>
      <div class="cal-field"><textarea>Text</textarea></div>
      <button disabled>Disabled</button>
    </section>`)
  const positions = await page.locator('.response-card').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top))
  assert.equal(new Set(positions).size, 1, 'Density must not wrap a three-card response row')
  assert.equal(await style('.response-fallback', 'color'), 'rgb(240, 237, 225)')
  assert.equal(await style('.cal-title', 'font-weight'), '600')
  assert.equal(await style('.cal-field textarea', 'line-height'), '27px')
  assert.equal(await style('button:disabled', 'opacity'), '0.6')
  await page.locator('textarea').focus()
  assert.equal(await style('textarea', 'outline-color'), 'rgb(0, 128, 0)')
  await page.setContent(`<style>${css} ${featureCss.join('\n')}</style>
    <section data-theme="light" style="--button-motion:0ms;--button-bg:rgb(12,34,56);--button-color:rgb(230,240,250);--button-radius:9px;--button-hover-bg:rgb(56,34,12);--button-selected-color:rgb(1,2,3);--button-disabled-opacity:0.2;--button-focus-color:rgb(0,128,0);--input-bg:rgb(240,230,220);--input-color:rgb(10,20,30);--input-radius:7px;--input-placeholder-color:rgb(70,80,90);--input-focus-color:rgb(0,128,0);--input-invalid-border:rgb(200,0,0);--input-readonly-bg:rgb(210,220,230);--form-gap:21px;--form-label-color:rgb(40,50,60)">
      <button class="cal-btn" data-primary>Calendar</button>
      <div class="work-bar"><button class="work-add" disabled>Add</button></div>
      <div class="room-choice-options"><button aria-pressed="true">Selected</button></div>
      <div class="cal-dialog"><form><label class="cal-field"><span>Label</span><input placeholder="Name" /></label></form></div>
      <input class="field" aria-invalid="true" />
      <div class="work-compose"><textarea readonly>Read only</textarea></div>
      <div class="room-chatbox-attach"><input type="file" /></div>
    </section>`)
  assert.equal(await style('.cal-btn', 'background-color'), 'rgb(12, 34, 56)')
  assert.equal(await style('.cal-btn', 'color'), 'rgb(230, 240, 250)')
  assert.equal(await style('.cal-btn', 'border-radius'), '9px')
  await page.locator('.cal-btn').hover()
  assert.equal(await style('.cal-btn', 'background-color'), 'rgb(56, 34, 12)')
  await page.keyboard.press('Tab')
  await page.locator('.cal-btn').focus()
  assert.equal(await style('.cal-btn', 'outline-color'), 'rgb(0, 128, 0)')
  assert.equal(await style('.work-add', 'opacity'), '0.2')
  assert.equal(await style('.room-choice-options button', 'color'), 'rgb(1, 2, 3)')
  assert.equal(await style('.cal-field input', 'background-color'), 'rgb(240, 230, 220)')
  assert.equal(await style('.cal-field input', 'border-radius'), '7px')
  assert.equal(await page.locator('.cal-field input').evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgb(70, 80, 90)')
  await page.locator('.cal-field input').focus()
  assert.equal(await style('.cal-field input', 'outline-color'), 'rgb(0, 128, 0)')
  assert.equal(await style('.field', 'border-bottom-color'), 'rgb(200, 0, 0)')
  assert.equal(await style('.work-compose textarea', 'background-color'), 'rgb(210, 220, 230)')
  assert.equal(await style('.cal-dialog form', 'gap'), '21px')
  assert.equal(await style('.cal-field span', 'color'), 'rgb(40, 50, 60)')
  assert.equal(await style('input[type=file]', 'width'), '1px')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.setContent(`<style>${css} ${featureCss.join('\n')}</style>
    <section data-theme="light" style="--page-gutter:40px;--page-gutter-mobile:18px;--content-width-standard:900px;--content-width-wide:1000px;--section-gap:30px;--panel-width:360px;--panel-padding:28px">
      <div class="lobby-body"><section class="lobby-section"><div class="conv-grid"><div class="conv-card">Card</div><div class="conv-card">Card</div></div></section></div>
      <div class="explorer"><div class="explorer-layout">Explorer</div></div>
      <nav class="work-nav">Navigation</nav><div class="work-bar">Work</div><div class="cal-bar">Calendar</div>
      <div class="reply-instrument"><div class="reply-instrument-header">Reply</div><div class="reply-instrument-body">Body</div><div class="reply-instrument-footer">Footer</div></div>
      <div class="edit-sheet"><div class="edit-sheet-bar">Edit</div><div class="edit-sheet-body">Body</div><div class="edit-sheet-foot">Footer</div></div>
    </section>`)
  assert.equal(await style('.lobby-body', 'width'), '900px')
  assert.equal(await style('.explorer', 'width'), '1000px')
  for (const selector of ['.lobby-body', '.explorer', '.work-nav', '.work-bar', '.cal-bar']) {
    assert.equal(await style(selector, 'padding-left'), '40px', selector)
  }
  assert.equal(await style('.lobby-section', 'margin-top'), '30px')
  assert.equal(await style('.explorer-layout', 'gap'), '30px')
  assert.equal(await style('.conv-grid', 'gap'), '30px')
  for (const selector of ['.reply-instrument', '.edit-sheet']) {
    assert.equal(await style(selector, 'width'), '360px', selector)
  }
  for (const selector of ['.reply-instrument-header', '.reply-instrument-body', '.reply-instrument-footer', '.edit-sheet-bar', '.edit-sheet-body', '.edit-sheet-foot']) {
    assert.equal(await style(selector, 'padding-left'), '28px', selector)
  }
  await page.setViewportSize({ width: 320, height: 640 })
  for (const selector of ['.lobby-body', '.explorer', '.work-nav', '.work-bar', '.cal-bar']) {
    assert.equal(await style(selector, 'padding-left'), '18px', selector)
  }
  for (const selector of ['.lobby-body', '.explorer', '.reply-instrument', '.edit-sheet']) {
    assert.equal(await style(selector, 'width'), '320px', selector)
  }
  await page.locator('section[data-theme]').evaluate(el => el.style.setProperty('--page-gutter-mobile', '40px'))
  const fits = await page.locator('.conv-grid').evaluate(el => el.scrollWidth <= el.clientWidth)
  assert.ok(fits, 'Cards must fit even when page gutters leave less than the preferred card width')
  console.log('Theme, density, controls, shared layouts, and CSS token audit checks passed.')
} finally {
  await browser.close()
}
