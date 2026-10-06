export type Point = { x: number; y: number }
export type Viewport = Point & { zoom: number }
export type Bounds = Point & { width: number; height: number }
export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 64
export const worldPoint = (view: Viewport, point: Point): Point => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom })
export const screenPoint = (view: Viewport, point: Point): Point => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y })
export function zoomAt(view: Viewport, point: Point, zoom: number): Viewport {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
  const anchor = worldPoint(view, point)
  return { x: point.x - anchor.x * next, y: point.y - anchor.y * next, zoom: next }
}
export function boundsOf(items: Bounds[]): Bounds | null {
  if (!items.length) return null
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const item of items) {
    x = Math.min(x, item.x); y = Math.min(y, item.y)
    right = Math.max(right, item.x + item.width); bottom = Math.max(bottom, item.y + item.height)
  }
  return { x, y, width: right - x, height: bottom - y }
}
export function fitBounds(bounds: Bounds, size: { width: number; height: number }): Viewport {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (Math.max(1, size.width - 96)) / Math.max(1, bounds.width), Math.max(1, size.height - 96) / Math.max(1, bounds.height)))
  return { zoom, x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom }
}
export function isVisible(bounds: Bounds, view: Viewport, size: { width: number; height: number }, margin = 160) {
  const start = screenPoint(view, bounds)
  return start.x + bounds.width * view.zoom >= -margin && start.y + bounds.height * view.zoom >= -margin && start.x <= size.width + margin && start.y <= size.height + margin
}
