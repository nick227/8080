import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { loadStyles } from './style-utils.mjs'

const output = await mkdtemp(join(tmpdir(), 'theme-gallery-build-'))
const screenshots = process.env.THEME_SCREENSHOTS
const browser = await chromium.launch()
const contrast = (a,b) => {
  const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4)
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722
  }
  const x=luminance(a),y=luminance(b)
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)
}
try {
  execFileSync('pnpm',['exec','esbuild','tests/theme-gallery.fixture.tsx','--bundle','--jsx=automatic',`--outfile=${join(output,'gallery.js')}`],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'pipe'})
  const script=await readFile(join(output,'gallery.js'),'utf8')
  const features=(await Promise.all(['work/work.css','calendar/calendar.css'].map(name=>readFile(new URL(`../src/features/${name}`,import.meta.url),'utf8')))).join('\n')
  const css=await loadStyles()+features+`
    .gallery-page { padding-top:calc(var(--mast) + var(--page-padding-block)); }
    .gallery-intro { margin-bottom:var(--section-gap); }
    .gallery-kicker { color:var(--signal);font:var(--text-xs) var(--mono);letter-spacing:var(--tracking-spaced); }
    .gallery-intro h1 { font-family:var(--content-font);font-size:clamp(32px,4vw,52px);font-weight:var(--weight-medium);margin:var(--space-2) 0; }
    .gallery-description { color:var(--muted);font-size:var(--text-body);max-width:70ch;line-height:var(--leading-body); }
    .gallery-grid { display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,34%);gap:var(--section-gap);align-items:start; }
    .gallery-main {min-width:0;}.gallery-panel {width:100%;}.gallery-card {content-visibility:visible;margin-top:var(--space-md);border-radius:var(--radius-card);background:var(--panel);}
    .gallery-card h2 {font-family:var(--content-font);font-size:var(--text-title);line-height:var(--leading-heading);font-weight:var(--weight-medium);margin:var(--space-md) 0;overflow-wrap:anywhere;}
    .gallery-copy {font-size:var(--text-body);line-height:var(--leading-body);}
    .gallery-meta {font:var(--text-xs) var(--mono);color:var(--muted);}.work-bar .gallery-meta{margin-left:auto;}
    .gallery-wave {display:flex;align-items:center;gap:var(--space-xs);height:72px;margin-block:var(--space-md);}.gallery-wave i{flex:1;background:var(--signal);border-radius:var(--radius-sm);}
    .gallery-actions {display:flex;gap:var(--space-sm);align-items:center;flex-wrap:wrap;}
    .gallery-docs {margin-top:var(--section-gap);}.gallery-docs h3 {font-size:var(--text-body);font-weight:var(--weight-medium);}
    .ui-input {width:100%;min-width:0;}.ui-form-help{margin:0;line-height:var(--leading-body);}
    @media(max-width:720px){.gallery-grid{grid-template-columns:minmax(0,1fr);}}
  `
  const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('http://theme.test/**',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}))
  await page.goto('http://theme.test/')
  const select=page.getByRole('combobox',{name:'Theme'})
  await select.waitFor()
  const ids=await select.locator('option').evaluateAll(options=>options.map(o=>o.value))
  assert.ok(ids.length >= 17)
  assert.equal(new Set(ids).size,ids.length)
  if(screenshots)await mkdir(screenshots,{recursive:true})
  const report=[]
  for(const id of ids){
    await page.setViewportSize({width:1280,height:1000})
    await select.selectOption(id)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.locator('html').getAttribute('data-theme'),id)
    await page.evaluate(() => document.getAnimations().forEach(animation => { if (animation.effect?.getTiming().iterations !== Infinity) animation.finish() }))
    const values=await page.evaluate(()=>{
      const style=getComputedStyle(document.documentElement)
      const color=token=>{const e=document.createElement('span');e.style.color=`var(${token})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c}
      const button=getComputedStyle(document.querySelector('.ui-button'))
      return {bg:color('--bg'),ink:color('--ink'),muted:color('--muted'),signal:color('--signal'),buttonBg:button.backgroundColor,buttonInk:button.color,buttonToken:button.getPropertyValue("--button-bg"),duration:button.transitionDuration,rootToken:style.getPropertyValue("--button-bg"),motion:style.getPropertyValue('--motion-fast').trim(),body:parseFloat(style.getPropertyValue('--text-body')),density:parseFloat(style.getPropertyValue('--density'))}
    })
    assert.ok(contrast(values.ink,values.bg)>=7,`${id}: body contrast`)
    // Original dark/light presets remain supported; validate the new collection strictly.
    if(!['dark','light'].includes(id)){
      assert.ok(contrast(values.muted,values.bg)>=4.5,`${id}: muted contrast ${contrast(values.muted,values.bg)}`)
      assert.ok(contrast(values.signal,values.bg)>=4.5,`${id}: accent contrast`)
      assert.ok(contrast(values.buttonInk,values.buttonBg)>=4.5,`${id}: button contrast ${JSON.stringify(values)}`)
    }
    assert.equal(values.motion,'0ms',`${id}: reduced motion`)
    if(id==='ultra-large'){assert.ok(values.body>=20);assert.ok(values.density>1)}
    if(id==='ultra-compact'){assert.ok(values.body>=13);assert.equal(values.density,0.75)}
    // Test actual pointer-down rendering, including alpha backgrounds. Resting
    // snapshots alone missed the original foreground/background mismatch.
    for (const selector of ['.ui-button:not(:disabled):not([data-button])', '.gallery-actions .cal-btn:not([aria-pressed])', '.gallery-actions [aria-pressed="true"]', '[data-button="quiet"]']) {
      const control = page.locator(selector)
      for (const pressed of [false, true]) {
        await control.hover()
        if (pressed) await page.mouse.down()
        await page.evaluate(() => document.getAnimations().forEach(animation => { if (animation.effect?.getTiming().iterations !== Infinity) animation.finish() }))
        const colors = await control.evaluate(element => {
          const style = getComputedStyle(element)
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const ctx = canvas.getContext('2d')
          const ancestors = []; for (let node = element.parentElement; node; node = node.parentElement) ancestors.unshift(node)
          const pixel = color => {
            ctx.clearRect(0,0,1,1)
            for (const node of ancestors) { ctx.fillStyle = getComputedStyle(node).backgroundColor; ctx.fillRect(0,0,1,1) }
            ctx.fillStyle = color; ctx.fillRect(0,0,1,1)
            return `rgb(${[...ctx.getImageData(0,0,1,1).data].slice(0,3).join(',')})`
          }
          return { fg: pixel(style.color), bg: pixel(style.backgroundColor) }
        })
        if (pressed) await page.mouse.up()
        assert.ok(contrast(colors.fg, colors.bg) >= 4.5, `${id}: ${selector} ${pressed ? 'pressed' : 'hover'} contrast ${contrast(colors.fg, colors.bg)}`)
      }
    }
    await page.mouse.move(0,0)
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0,0) })
    if(screenshots)await page.screenshot({path:join(screenshots,`${id}.png`),fullPage:true})
    for(const width of [375,320]){
      await page.setViewportSize({width,height:900})
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const bounds=await page.locator('.mast, .mast-actions').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right}}))
      assert.ok(bounds[0].right<=bounds[1].left+1 && bounds[1].right<=width,`${id}: header overlap at ${width}px ${JSON.stringify(bounds)}`)
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)
      assert.ok(fits,`${id}: horizontal overflow at ${width}px ${!fits ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.className || el.tagName).join(', ')) : ''}`)
    }
    if(screenshots)await page.screenshot({path:join(screenshots,`${id}-mobile.png`),fullPage:true})
    report.push(id)
  }
  const touch = await browser.newPage({viewport:{width:375,height:900},hasTouch:true,reducedMotion:'reduce'})
  await touch.route('http://theme.test/**',route=>route.fulfill({contentType:'text/html',body:`<style>${css}</style><div id="root"></div><script>${script}</script>`}))
  await touch.goto('http://theme.test/')
  for (const id of ids) {
    await touch.getByRole('combobox',{name:'Theme'}).selectOption(id)
    const heights = await touch.locator('.ui-button, .cal-btn, .work-bar .work-add').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height))
    assert.ok(heights.length > 0 && heights.every(height=>height >= 44), `${id}: touch targets below 44px: ${heights}`)
  }
  await touch.close()
  assert.deepEqual(errors,[])
  console.log(`Validated ${report.length} themes: ${report.join(', ')}`)
} finally {await browser.close();await rm(output,{recursive:true,force:true})}
