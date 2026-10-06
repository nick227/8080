import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DocumentRecord, EdgeDirection, MapEdge, MapNode, MapShape, NubPos } from '../types'
import { notePresence, usePeers, type Drag } from '../presence'
import { useDocuments } from '../store'
import '../../work/map-extras.css'
import { boundsOf, fitBounds, isVisible, worldPoint, zoomAt } from './mapViewport'
import { useMapViewport } from './useMapViewport'

const SHAPES: { shape: MapShape; label: string }[] = [
  { shape: 'rect', label: 'Rect' },
  { shape: 'round', label: 'Round' },
  { shape: 'circle', label: 'Circle' },
  { shape: 'diamond', label: 'Diamond' },
]



const COLORS = [
  { bg: '#07080a', text: 'var(--ink)', label: 'Default' },
  { bg: '#FFFFFF', text: '#000000', label: 'White' },
  { bg: '#FF3333', text: '#FFFFFF', label: 'Red' },
  { bg: '#3333FF', text: '#FFFFFF', label: 'Blue' },
  { bg: '#FFFF33', text: '#000000', label: 'Yellow' },
  { bg: '#33FF33', text: '#000000', label: 'Green' }
]

function getNubCoords(node: MapNode, nub: NubPos) {
  if (nub === 'top') return { x: node.x + node.width / 2, y: node.y }
  if (nub === 'right') return { x: node.x + node.width, y: node.y + node.height / 2 }
  if (nub === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
  return { x: node.x, y: node.y + node.height / 2 } // left
}

export function MapEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const peers = usePeers()
  const nodes = doc.nodes ?? []
  const edges = doc.edges ?? []

  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])

  // connection state
  type ConnectionState = { nodeId: string; nub: NubPos; startX: number; startY: number } | null
  const [connecting, setConnecting] = useState<ConnectionState>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  const [activeColor, setActiveColor] = useState(COLORS[0].bg)
  const [liveNodes, setLiveNodes] = useState<Record<string, Drag>>({})
  const liveRef = useRef<Record<string, Drag>>({})
  const liveFrame = useRef(0)
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => { cancelAnimationFrame(liveFrame.current); dragCleanup.current?.() }, [])
  const previewDrag = (nexts: Record<string, Drag>) => {
    liveRef.current = { ...liveRef.current, ...nexts }
    if (!liveFrame.current) liveFrame.current = requestAnimationFrame(() => {
      liveFrame.current = 0
      setLiveNodes(liveRef.current)
    })
  }

  const canvas = useRef<HTMLDivElement>(null)
  const viewport = useMapViewport(canvas)
  const { view, size } = viewport
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const placed = useMemo(() => {
    const remote = new Map(peers.filter(p => p.drag).map(p => [p.drag!.nodeId, p.drag!]))
    return new Map(nodes.map(node => {
      const drag = liveNodes[node.id] ?? remote.get(node.id)
      return [node.id, drag ? { ...node, ...drag } : node]
    }))
  }, [nodes, liveNodes, peers])
  type EdgeGeometry = { edge: MapEdge; from: MapNode; to: MapNode; start: { x: number; y: number }; end: { x: number; y: number }; bounds: { x: number; y: number; width: number; height: number } }
  const edgeCache = useRef(new Map<string, EdgeGeometry>())
  const geometry = useMemo(() => {
    const nextCache = new Map<string, EdgeGeometry>()
    const result = edges.flatMap(edge => {
      const from = placed.get(edge.sourceId), to = placed.get(edge.targetId)
      if (!from || !to) return []
      const cached = edgeCache.current.get(edge.id)
      if (cached?.edge === edge && cached.from === from && cached.to === to) {
        nextCache.set(edge.id, cached)
        return [cached]
      }
      const start = edge.sourceNub ? getNubCoords(from, edge.sourceNub) : { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      const end = edge.targetNub ? getNubCoords(to, edge.targetNub) : { x: to.x + to.width / 2, y: to.y + to.height / 2 }
      const item = { edge, from, to, start, end, bounds: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) } }
      nextCache.set(edge.id, item)
      return [item]
    })
    edgeCache.current = nextCache
    return result
  }, [edges, placed])
  const fit = (selection: boolean) => {
    const bounds = boundsOf([...placed.values()].filter(n => !selection || selectedNodes.includes(n.id) || edges.some(e => selectedEdges.includes(e.id) && (e.sourceId === n.id || e.targetId === n.id))))
    if (bounds) viewport.update(fitBounds(bounds, size))
  }
  const [clipboard, setClipboard] = useState<MapNode[]>([])
  const [history, setHistory] = useState<MapNode[][]>([])

  const commitNodes = (next: MapNode[]) => {
    setHistory((prev) => [...prev, nodes])
    change(doc.id, (current) => ({ ...current, nodes: next }))
  }
  const commitEdges = (next: MapEdge[]) => change(doc.id, (current) => ({ ...current, edges: next }))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return

      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const copied = nodes.filter(n => selectedNodes.includes(n.id))
        if (copied.length > 0) {
          setClipboard(copied)
          event.preventDefault()
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (clipboard.length > 0) {
          const bounds = boundsOf(clipboard)!
          const center = worldPoint(viewport.current.current, pointer.current ?? { x: size.width / 2, y: size.height / 2 })
          const pasted = clipboard.map(c => ({ ...c, id: crypto.randomUUID(), x: c.x + center.x - bounds.x - bounds.width / 2, y: c.y + center.y - bounds.y - bounds.height / 2 }))
          commitNodes([...nodes, ...pasted])
          setSelectedNodes(pasted.map(p => p.id))
          event.preventDefault()
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        if (history.length > 0) {
          const prev = history[history.length - 1]
          setHistory(history.slice(0, -1))
          change(doc.id, (current) => ({ ...current, nodes: prev }))
          event.preventDefault()
        }
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedNodes.length === 0 && selectedEdges.length === 0) return
      event.preventDefault()

      if (selectedNodes.length > 0) {
        commitNodes(nodes.filter((node) => !selectedNodes.includes(node.id)))
        commitEdges(edges.filter((edge) => !selectedNodes.includes(edge.sourceId) && !selectedNodes.includes(edge.targetId)))
      }
      if (selectedEdges.length > 0) {
        commitEdges(edges.filter((edge) => !selectedEdges.includes(edge.id)))
      }
      setSelectedNodes([])
      setSelectedEdges([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pickNode = (id: string, shift: boolean) => {
    setSelectedEdges([])
    if (shift) {
      setSelectedNodes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    } else {
      // Only set to single node if it's not already selected.
      // If it is already selected, dragging it shouldn't deselect others immediately.
      // (Deselection of others when clicking a selected node without dragging is typically handled on mouse up, but for simplicity here we just avoid deselecting).
      setSelectedNodes(prev => prev.includes(id) ? prev : [id])
    }
    notePresence({ activity: 'editing', focus: { kind: 'node', id } })
  }

  const pickEdge = (id: string, shift: boolean) => {
    setSelectedNodes([])
    if (shift) {
      setSelectedEdges(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    } else {
      setSelectedEdges([id])
    }
  }

  const add = (shape: MapShape) => {
    const center = worldPoint(viewport.current.current, { x: size.width / 2, y: size.height / 2 })
    const item: MapNode = { id: crypto.randomUUID(), shape, x: center.x - 74, y: center.y - 36, width: 148, height: 72, text: 'New', color: activeColor }
    commitNodes([...nodes, item])
    setSelectedNodes([item.id])
    setSelectedEdges([])
  }

  const onCanvasMove = (event: React.PointerEvent) => {
    if (viewport.move(event)) return
    const box = canvas.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    pointer.current = { x, y }
    const world = worldPoint(viewport.current.current, { x, y })
    if (connecting) setCursorPos(world)
    notePresence({ cursor: { ...world, space: 'map' } })
  }

  const onCanvasUp = () => {
    // If user was connecting but dropped on nothing, clear connecting state
    if (connecting) {
      setConnecting(null)
    }
  }

  const changeColor = (bg: string) => {
    setActiveColor(bg)
    if (selectedNodes.length > 0) {
      commitNodes(nodes.map(n => selectedNodes.includes(n.id) ? { ...n, color: bg } : n))
    }
  }

  // Reuse the scene during navigation when its culled membership is unchanged.
  // Only the enclosing transform and CSS screen-size variables need updating.
  const visibleNodeKey = JSON.stringify(nodes.filter(node => isVisible(placed.get(node.id)!, view, size) || selectedNodes.includes(node.id)).map(n => n.id))
  const visibleEdgeKey = JSON.stringify(geometry.filter(item => isVisible(item.bounds, view, size)).map(item => item.edge.id))
  const scene = useMemo(() => {
    const visibleNodes = new Set<string>(JSON.parse(visibleNodeKey))
    const visibleEdges = new Set<string>(JSON.parse(visibleEdgeKey))
    return <>
        <svg className="work-edges" aria-hidden>
          <defs>
            <marker id="map-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6" fill="none" stroke="currentColor" />
            </marker>
          </defs>

          {/* Live Connecting Line */}
          {connecting && cursorPos && (
            <line
              x1={connecting.startX}
              y1={connecting.startY}
              x2={cursorPos.x}
              y2={cursorPos.y}
              stroke="#3333FF"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          )}

          {geometry.filter(item => visibleEdges.has(item.edge.id)).map(({ edge, start: startCoords, end: endCoords }) => {
            const isSelected = selectedEdges.includes(edge.id)

            return (
              <g key={edge.id} onPointerDown={(event) => { event.stopPropagation(); pickEdge(edge.id, event.shiftKey) }} style={{ cursor: 'pointer' }}>
                <line
                  x1={startCoords.x} y1={startCoords.y} x2={endCoords.x} y2={endCoords.y}
                  style={{ stroke: 'transparent', strokeWidth: 16 }}
                />
                <line
                  x1={startCoords.x} y1={startCoords.y} x2={endCoords.x} y2={endCoords.y}
                  className={isSelected ? 'is-selected' : undefined}
                  stroke={isSelected ? '#3333FF' : 'var(--line)'}
                  markerEnd={edge.direction === 'forward' || edge.direction === 'both' ? 'url(#map-arrow)' : undefined}
                  markerStart={edge.direction === 'back' || edge.direction === 'both' ? 'url(#map-arrow)' : undefined}
                />
                {edge.label && <text x={(startCoords.x + endCoords.x) / 2} y={(startCoords.y + endCoords.y) / 2} fill="var(--ink)" textAnchor="middle" dy="-4">{edge.label}</text>}
              </g>
            )
          })}
        </svg>

        {nodes.filter(node => visibleNodes.has(node.id)).map((node) => {
          const shown = placed.get(node.id)!
          const colorObj = COLORS.find(c => c.bg === (node.color || '#07080a')) || COLORS[0]
          const isSelected = selectedNodes.includes(node.id)
          const borderColor = colorObj.bg !== '#07080a' ? colorObj.bg : 'var(--line)'
          const activeBorderColor = isSelected ? '#3333FF' : borderColor

          return (
            <div
              key={node.id}
              className="work-node"
              data-shape={node.shape}
              data-selected={isSelected ? '' : undefined}
              style={{
                left: shown.x, top: shown.y, width: shown.width, height: shown.height,
                backgroundColor: colorObj.bg, color: colorObj.text, borderColor: activeBorderColor,
                boxShadow: isSelected && node.shape !== 'diamond' ? '0 0 0 var(--map-outline) #3333FF' : 'none',
                '--node-bg': colorObj.bg, '--node-border': activeBorderColor
              } as any}
              onPointerDown={(event) => {
                event.stopPropagation()
                pickNode(node.id, event.shiftKey)
                if (connecting !== null) return
                const targets = (isSelected || event.shiftKey) ? (isSelected ? selectedNodes : [...selectedNodes, node.id]) : [node.id]
                dragNodes(event.currentTarget, event, targets, 'move',
                  previewDrag,
                  () => finish()
                )
              }}
            >
              {node.shape === 'diamond' && (
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0, zIndex: -1 }}>
                  <polygon points="50,1 99,50 50,99 1,50" fill={colorObj.bg} stroke={activeBorderColor} vectorEffect="non-scaling-stroke" strokeWidth={isSelected ? "3" : "1"} />
                </svg>
              )}
              <input
                aria-label="Shape text"
                onFocus={() => pickNode(node.id, false)}
                value={node.text}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => commitNodes(nodes.map((item) => item.id === node.id ? { ...item, text: event.target.value } : item))}
              />
              <button type="button" className="work-resize" aria-label="Resize" onPointerDown={(event) => {
                event.stopPropagation()
                const targets = isSelected ? selectedNodes : [node.id]
                pickNode(node.id, false)
                dragNodes(event.currentTarget, event, targets, 'resize',
                  previewDrag,
                  () => finish()
                )
              }} />

              {/* Nubs for connecting */}
              {(['top', 'right', 'bottom', 'left'] as NubPos[]).map(pos => {
                const isThisNubConnecting = connecting?.nodeId === node.id && connecting?.nub === pos
                return (
                  <div
                    key={pos}
                    className={`work-nub ${isThisNubConnecting ? 'is-connecting' : ''}`}
                    data-pos={pos}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (connecting && connecting.nodeId !== node.id) {
                        // Complete connection on mouse down if click-then-click approach
                        commitEdges([...edges, { id: crypto.randomUUID(), sourceId: connecting.nodeId, targetId: node.id, sourceNub: connecting.nub, targetNub: pos, direction: 'forward' }])
                        setConnecting(null)
                      } else {
                        // Start connection
                        const box = canvas.current?.getBoundingClientRect()
                        if (box) {
                          const coords = getNubCoords(shown, pos)
                          setCursorPos(coords)
                          setConnecting({ nodeId: node.id, nub: pos, startX: coords.x, startY: coords.y })
                        }
                      }
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation()
                      if (connecting && connecting.nodeId !== node.id) {
                        // Complete connection on mouse up (drag approach)
                        commitEdges([...edges, { id: crypto.randomUUID(), sourceId: connecting.nodeId, targetId: node.id, sourceNub: connecting.nub, targetNub: pos, direction: 'forward' }])
                        setConnecting(null)
                      }
                    }}
                  />
                )
              })}
            </div>
          )
        })}
    </>
  }, [visibleNodeKey, visibleEdgeKey, placed, geometry, nodes, edges, selectedNodes, selectedEdges, connecting, cursorPos, doc.id, change])

  return (
    <div className="work-map-wrap" style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
      <div className="work-floating-shapes" style={{ width: '120px', flexShrink: 0, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0', background: '#07080a', borderRight: '1px solid var(--line)', padding: '16px', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shapes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {SHAPES.map((item) => (
            <button
              key={item.shape}
              type="button"
              onClick={() => add(item.shape)}
              style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '8px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', borderRadius: 0 }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Color</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
          {COLORS.map(c => (
            <button
              key={c.bg}
              type="button"
              style={{
                width: '39px', height: '26px', background: c.bg,
                border: `2px solid ${activeColor === c.bg ? '#3333FF' : c.bg === '#07080a' ? 'var(--line)' : c.bg}`,
                borderRadius: 0, padding: 0, cursor: 'pointer'
              }}
              onClick={() => changeColor(c.bg)}
              title={c.label}
            />
          ))}
        </div>

        <div className="map-viewport-controls">
          <button type="button" onClick={() => fit(false)}>Fit all</button>
          <button type="button" disabled={!selectedNodes.length && !selectedEdges.length} onClick={() => fit(true)}>Fit selection</button>
          <button type="button" title="Reset zoom to 100%" onClick={() => viewport.update(zoomAt(viewport.current.current, { x: size.width / 2, y: size.height / 2 }, 1))}>{Math.round(view.zoom * 100)}%</button>
        </div>
        {selectedEdges.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)', marginTop: '8px', marginBottom: '4px', textTransform: 'uppercase' }}>Line</div>
            <select
              value={edges.find(e => e.id === selectedEdges[0])?.direction || 'none'}
              onChange={(e) => {
                const val = e.target.value as EdgeDirection
                commitEdges(edges.map(edge => selectedEdges.includes(edge.id) ? { ...edge, direction: val } : edge))
              }}
              style={{ background: '#07080a', color: 'var(--ink)', border: '1px solid var(--line)', padding: '4px', borderRadius: '4px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              <option value="none">None</option>
              <option value="forward">Forward →</option>
              <option value="back">← Back</option>
              <option value="both">↔ Both</option>
            </select>
          </>
        )}
      </div>

      <div
        ref={canvas}
        className={`work-map ${connecting ? 'is-connecting-mode' : ''}`}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
        onPointerMove={onCanvasMove}
        onPointerDownCapture={(event) => {
          if (event.target === canvas.current && event.button === 0) { setSelectedNodes([]); setSelectedEdges([]); setConnecting(null) }
          viewport.down(event)
        }}
        onPointerUp={(event) => { viewport.up(event); onCanvasUp() }}
        onPointerCancel={(event) => { viewport.up(event); setConnecting(null) }}
        onLostPointerCapture={viewport.up}
        onPointerLeave={() => { pointer.current = null }}
        onPointerDown={() => { setSelectedNodes([]); setSelectedEdges([]); setConnecting(null) }}
      >
        <div className="map-world" data-tiny={view.zoom < 0.15 ? '' : undefined} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, '--map-handle-scale': 1 / view.zoom, '--map-outline': `${2 / view.zoom}px`, '--map-stroke': `${1 / view.zoom}px`, '--node-min-hit': `${12 / view.zoom}px` } as React.CSSProperties}>
        {scene}
        </div>
        {peers.map((peer) => peer.cursor && (
          <span key={peer.clientId} className="work-cursor" style={{ left: peer.cursor.space === 'map' ? peer.cursor.x * view.zoom + view.x : `${peer.cursor.x * 100}%`, top: peer.cursor.space === 'map' ? peer.cursor.y * view.zoom + view.y : `${peer.cursor.y * 100}%` }}>{peer.name}</span>
        ))}
      </div>
    </div>
  )

  function finish() {
    const nexts = liveRef.current
    cancelAnimationFrame(liveFrame.current)
    liveFrame.current = 0
    setLiveNodes({})
    liveRef.current = {}
    notePresence({ drag: null, activity: 'viewing' })
    setHistory(prev => [...prev, nodes])
    change(doc.id, current => ({ ...current, nodes: (current.nodes ?? []).map(node => {
      const n = nexts[node.id]
      return n ? { ...node, x: n.x, y: n.y, width: n.width, height: n.height } : node
    }) }))
  }

  function dragNodes(handle: HTMLElement, event: ReactPointerEvent, targets: string[], mode: 'move' | 'resize', onMove: (nexts: Record<string, Drag>) => void, onUp: () => void) {
    const origins = targets.map(id => {
      const node = placed.get(id)!
      return { id, x: node.x, y: node.y, width: node.width, height: node.height }
    })
    const start = viewport.toWorld(event)

    handle.setPointerCapture(event.pointerId)
    const move = (ev: PointerEvent) => {
      const point = viewport.toWorld(ev)
      const dx = point.x - start.x
      const dy = point.y - start.y
      const nexts: Record<string, Drag> = {}
      origins.forEach(orig => {
        nexts[orig.id] = mode === 'move'
          ? { nodeId: orig.id, x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height }
          : { nodeId: orig.id, x: orig.x, y: orig.y, width: Math.max(72, orig.width + dx), height: Math.max(48, orig.height + dy) }
      })
      notePresence({ drag: nexts[targets[0]], activity: 'editing' })
      onMove(nexts)
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.removeEventListener('lostpointercapture', up)
      dragCleanup.current = null
    }
    const up = () => { cleanup(); onUp() }
    dragCleanup.current?.()
    dragCleanup.current = cleanup
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    handle.addEventListener('lostpointercapture', up)
  }
}
