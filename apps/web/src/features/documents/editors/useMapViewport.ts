import { useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react'
import { worldPoint, zoomAt, type Point, type Viewport } from './mapViewport'

export function useMapViewport(canvas: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const current = useRef(view)
  const frame = useRef(0)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const pointers = useRef(new Map<number, Point>())
  const wheelFrame = useRef(0)
  const wheelTarget = useRef<Viewport | null>(null)
  const space = useRef(false)
  const navigating = useRef(false)
  const update = (next: Viewport) => {
    current.current = next
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setView(current.current) })
  }
  const local = (event: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  useEffect(() => {
    const element = canvas.current!
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    const animateWheel = () => {
      const target = wheelTarget.current
      if (!target) { wheelFrame.current = 0; return }
      const before = current.current
      const settled = Math.abs(Math.log(target.zoom / before.zoom)) < 0.00001
      update(settled ? target : {
        x: before.x + (target.x - before.x) * 0.4,
        y: before.y + (target.y - before.y) * 0.4,
        zoom: before.zoom + (target.zoom - before.zoom) * 0.4,
      })
      if (settled) { wheelTarget.current = null; wheelFrame.current = 0 }
      else wheelFrame.current = requestAnimationFrame(animateWheel)
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (pointers.current.size) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      wheelTarget.current = zoomAt(current.current, local(event), (wheelTarget.current ?? current.current).zoom * Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002)))
      if (!wheelFrame.current) wheelFrame.current = requestAnimationFrame(animateWheel)
    }
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return
      if (event.code === 'Space') { space.current = event.type === 'keydown'; event.preventDefault() }
    }
    const blur = () => { space.current = false; pointers.current.clear() }
    element.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur)
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current); cancelAnimationFrame(wheelFrame.current)
      element.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur)
    }
  }, [canvas])
  const down = (event: PointerEvent) => {
    const background = event.target === canvas.current || (event.target as HTMLElement).classList?.contains('map-world')
    if (event.button !== 0 && event.button !== 1) return
    if (event.pointerType === 'touch') pointers.current.set(event.pointerId, local(event))
    const pinch = event.pointerType === 'touch' && pointers.current.size >= 2
    if (event.button !== 1 && !space.current && !background && !pinch) return
    event.preventDefault(); event.stopPropagation()
    wheelTarget.current = null
    navigating.current = true
    pointers.current.set(event.pointerId, local(event))
    for (const id of pointers.current.keys()) canvas.current!.setPointerCapture(id)
  }
  const move = (event: PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return false
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, local(event))
    const after = [...pointers.current.values()]
    if (!navigating.current) return false
    if (before.length >= 2) {
      const mid = (p: Point[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 })
      const distance = (p: Point[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
      const a = mid(before), b = mid(after)
      const next = zoomAt(current.current, a, current.current.zoom * distance(after) / Math.max(1, distance(before)))
      update({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y })
    } else {
      update({ ...current.current, x: current.current.x + after[0].x - before[0].x, y: current.current.y + after[0].y - before[0].y })
    }
    return true
  }
  const up = (event: PointerEvent) => {
    if (event.type === 'lostpointercapture' && event.target !== canvas.current) return
    pointers.current.delete(event.pointerId)
    if (!pointers.current.size) navigating.current = false
  }
  return { view, current, size, update: (next: Viewport) => { wheelTarget.current = null; update(next) }, local, down, move, up, toWorld: (event: { clientX: number; clientY: number }) => worldPoint(current.current, local(event)) }
}
