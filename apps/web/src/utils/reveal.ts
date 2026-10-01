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

// Scroll only when the grown video is not already on screen.
export function revealInSequence(child: HTMLElement) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
  const scroller = verticalScroller(child)
  const bounds = scroller?.getBoundingClientRect()
  const viewTop = (bounds?.top ?? 0) + 12
  const viewBottom = (bounds?.bottom ?? window.innerHeight) - 12
  const rect = child.getBoundingClientRect()
  const shown = Math.min(rect.bottom, viewBottom) - Math.max(rect.top, viewTop)
  const enough = shown >= Math.min(rect.height * 0.6, 220) && rect.top < viewBottom - 48
  if (!enough) {
    const delta = rect.top - (viewTop + 16)
    if (Math.abs(delta) > 8) {
      if (scroller) scroller.scrollBy({ top: delta, behavior })
      else window.scrollBy({ top: delta, behavior })
    }
  }
  const feed = child.closest('.feed')
  if (feed) {
    const frame = feed.getBoundingClientRect()
    const box = child.getBoundingClientRect()
    if (box.left < frame.left + 8) feed.scrollBy({ left: box.left - frame.left - 8, behavior })
    else if (box.right > frame.right - 8) feed.scrollBy({ left: box.right - frame.right + 8, behavior })
  }
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
