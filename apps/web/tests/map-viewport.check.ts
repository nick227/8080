import assert from 'node:assert/strict'
import { boundsOf, fitBounds, isVisible, screenPoint, worldPoint, zoomAt, MIN_ZOOM, MAX_ZOOM } from '../src/features/documents/editors/mapViewport'
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
let view = { x: -2345.125, y: 9821.75, zoom: 1 }
const focal = { x: 413.25, y: 279.5 }
const anchor = worldPoint(view, focal)
for (let i = 0; i < 1000; i++) {
  view = zoomAt(view, focal, i % 2 ? MAX_ZOOM : MIN_ZOOM)
  const world = worldPoint(view, focal)
  close(world.x, anchor.x); close(world.y, anchor.y)
}
for (const zoom of [MIN_ZOOM, .5, 1, 10, MAX_ZOOM]) {
  const v = { x: 123.5, y: -789.25, zoom }
  const original = { x: -1000000.125, y: 999999.75 }
  const roundTrip = worldPoint(v, screenPoint(v, original))
  close(roundTrip.x, original.x); close(roundTrip.y, original.y)
}
assert.equal(zoomAt(view, focal, 0).zoom, MIN_ZOOM)
assert.equal(zoomAt(view, focal, Infinity).zoom, MAX_ZOOM)
const bounds = boundsOf([{ x: -5000, y: -4000, width: 100, height: 50 }, { x: 6000, y: 8000, width: 400, height: 100 }])!
const size = { width: 1000, height: 800 }
const fit = fitBounds(bounds, size)
const corner = screenPoint(fit, bounds)
assert.ok(corner.x >= 47.999 && corner.y >= 47.999)
assert.ok(isVisible(bounds, fit, size))
assert.ok(!isVisible({ x: 1e8, y: 1e8, width: 100, height: 100 }, fit, size))
assert.ok(isVisible({ x: -100, y: 200, width: 1200, height: 0 }, { x: 0, y: 0, zoom: 1 }, size), 'Crossing edges remain visible')
assert.equal(boundsOf([]), null)
console.log('Map viewport focal stability, round trips, limits, fit, and culling passed.')
