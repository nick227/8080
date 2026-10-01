// Bring a feed item into view on whichever axis the layout scrolls: the desktop
// timeline scrolls horizontally inside .feed, the mobile feed scrolls the window.
// scrollIntoView handles both (nested scroller + page) in one call.
export function itemElement(number: number): HTMLElement | null {
  return document.getElementById(`item-${number}`)
}

export function revealItem(el: Element | null) {
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center', inline: 'center' })
}

function verticalScroller(el: Element): Element | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const y = getComputedStyle(node).overflowY
    if ((y === 'auto' || y === 'scroll') && node.scrollHeight > node.clientHeight + 2) return node
  }
  return null
}

const REVEAL_MS = 260
const revealTokens = new WeakMap<Element, number>()
let followGen = 0

// One short ease per scroller. Native smooth scroll is long and restarts if called
// twice, which is what made the page bounce while a response was opening.
function scrollQuick(el: Element, top: number, left: number) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    el.scrollTop += top
    el.scrollLeft += left
    return
  }
  const token = (revealTokens.get(el) ?? 0) + 1
  const gen = followGen
  revealTokens.set(el, token)
  const y0 = el.scrollTop
  const x0 = el.scrollLeft
  const start = performance.now()
  const step = (now: number) => {
    if (followGen !== gen || revealTokens.get(el) !== token) return
    const t = Math.min(1, (now - start) / REVEAL_MS)
    const e = 1 - (1 - t) ** 3
    el.scrollTop = y0 + top * e
    el.scrollLeft = x0 + left * e
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function scrollTarget(scroller: Element | null): Element {
  return scroller ?? document.scrollingElement ?? document.documentElement
}

// This item's own picture. Nested responses sit later in the body and must not win.
function playingFrame(child: HTMLElement): HTMLElement {
  const body = child.querySelector(':scope > .item-body') ?? child
  for (const node of body.children) {
    if (node.classList.contains('response-layer')) break
    const frame = node.matches('.yt-frame, .media-container') ? node : node.querySelector('.yt-frame, .media-container')
    if (frame instanceof HTMLElement) return frame
  }
  return child
}

// Open band between the crumb and the instrument. The video's centre lands here.
function viewMiddle(scroller: Element | null): number {
  const bounds = scroller?.getBoundingClientRect()
  const top = Math.max(bounds?.top ?? 0, document.querySelector('.crumb')?.getBoundingClientRect().bottom ?? 0)
  const bottom = Math.min(bounds?.bottom ?? window.innerHeight, document.querySelector('.instrument-floor')?.getBoundingClientRect().top ?? window.innerHeight)
  return (top + bottom) / 2
}

function placeInMiddle(child: HTMLElement) {
  const scroller = verticalScroller(child)
  const frame = playingFrame(child)
  const rect = frame.getBoundingClientRect()
  const delta = rect.top + rect.height / 2 - viewMiddle(scroller)
  const feed = child.closest('.feed')
  let left = 0
  if (feed) {
    const box = feed.getBoundingClientRect()
    const edge = child.getBoundingClientRect()
    if (edge.left < box.left + 8) left = edge.left - box.left - 8
    else if (edge.right > box.right - 8) left = edge.right - box.right + 8
  }
  if (feed && feed !== scroller && left) scrollQuick(feed, 0, left)
  if (Math.abs(delta) > 8) scrollQuick(scrollTarget(scroller), delta, feed === scroller ? left : 0)
}

// After a response finishes opening, put the playing picture in the middle.
export function revealInSequence(child: HTMLElement) {
  const mine = ++followGen
  const go = () => {
    if (mine !== followGen || !child.isConnected) return
    placeInMiddle(child)
  }
  const open = child.closest('.response-open')
  const running = open?.getAnimations().find((a) => a.playState === 'running')
  if (running) {
    running.finished.then(go).catch(() => {})
    return
  }
  if (!open) {
    go()
    return
  }
  // The open animation can start a frame after mount. Don't centre the collapsed box.
  requestAnimationFrame(() => {
    if (mine !== followGen) return
    const later = open.getAnimations().find((a) => a.playState === 'running')
    if (later) later.finished.then(go).catch(() => {})
    else go()
  })
}

// What the user can actually see of an item: the viewport, clipped by the nearest
// horizontally scrolling ancestor (the desktop timeline sits inside the page shell,
// so its visible edge is narrower than the window).
function visibleBounds(el: Element) {
  let left = 0, right = window.innerWidth
  const top = 0, bottom = window.innerHeight
  for (let a = el.parentElement; a; a = a.parentElement) {
    const ox = getComputedStyle(a).overflowX
    if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
      const r = a.getBoundingClientRect()
      left = Math.max(left, r.left)
      right = Math.min(right, r.right)
      break
    }
  }
  return { left, right, top, bottom }
}

// Stop an in-flight smooth follow-scroll (timeline + page) so the user's own scroll
// wins immediately instead of being fought by the tail of the animation.
export function haltFollowScroll(feed: Element | null) {
  followGen++
  if (feed) feed.scrollTo({ left: feed.scrollLeft, top: feed.scrollTop, behavior: 'instant' })
  window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
}

// Where an element sits relative to what's visible — used to point "return" at it.
export function directionTo(el: Element | null): '↑' | '↓' | '←' | '→' | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  const v = visibleBounds(el)
  if (r.right <= v.left) return '←'
  if (r.left >= v.right) return '→'
  if (r.bottom <= v.top) return '↑'
  if (r.top >= v.bottom) return '↓'
  return null
}

// "Back on it": the item's centre is inside the visible area (for tall items, its
// top or bottom edge is within the middle band of the screen).
export function isBackInView(el: Element | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  const v = visibleBounds(el)
  const cx = (r.left + r.right) / 2
  const band = (v.bottom - v.top) * 0.2
  const vertical = r.top < v.bottom - band && r.bottom > v.top + band
  return cx > v.left && cx < v.right && vertical
}
