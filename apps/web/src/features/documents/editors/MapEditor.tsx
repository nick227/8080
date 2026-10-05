import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DocumentRecord, EdgeDirection, MapEdge, MapNode, MapShape } from '../types'
import { notePresence, usePeers, type Drag } from '../presence'
import { useDocuments } from '../store'

const SHAPES: { shape: MapShape; label: string }[] = [
  { shape: 'rect', label: 'Rect' },
  { shape: 'round', label: 'Round' },
  { shape: 'circle', label: 'Circle' },
  { shape: 'diamond', label: 'Diamond' },
]

const NEXT: Record<EdgeDirection, EdgeDirection> = { forward: 'back', back: 'both', both: 'none', none: 'forward' }

type Selection = { kind: 'node' | 'edge'; id: string } | null

export function MapEditor({ doc }: { doc: DocumentRecord }) {
  const change = useDocuments((state) => state.change)
  const peers = usePeers()
  const nodes = doc.nodes ?? []
  const edges = doc.edges ?? []
  const [selected, setSelected] = useState<Selection>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [live, setLive] = useState<Drag | null>(null)
  const liveRef = useRef<Drag | null>(null)
  const canvas = useRef<HTMLDivElement>(null)

  const commitNodes = (next: MapNode[]) => change(doc.id, (current) => ({ ...current, nodes: next }))
  const commitEdges = (next: MapEdge[]) => change(doc.id, (current) => ({ ...current, edges: next }))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (!selected) return
      event.preventDefault()
      if (selected.kind === 'node') {
        commitNodes(nodes.filter((node) => node.id !== selected.id))
        commitEdges(edges.filter((edge) => edge.sourceId !== selected.id && edge.targetId !== selected.id))
      } else commitEdges(edges.filter((edge) => edge.id !== selected.id))
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pick = (id: string) => {
    if (connecting === null) {
      setSelected({ kind: 'node', id })
      notePresence({ activity: 'editing', focus: { kind: 'node', id } })
      return
    }
    if (!connecting) {
      setConnecting(id)
      return
    }
    if (connecting !== id) {
      commitEdges([...edges, { id: crypto.randomUUID(), sourceId: connecting, targetId: id, direction: 'forward' }])
    }
    setConnecting(null)
  }

  const add = (shape: MapShape) => {
    const item: MapNode = { id: crypto.randomUUID(), shape, x: 48 + nodes.length * 18, y: 48 + nodes.length * 18, width: 148, height: 72, text: 'New' }
    commitNodes([...nodes, item])
    setSelected({ kind: 'node', id: item.id })
  }

  const onCanvasMove = (event: React.PointerEvent) => {
    const box = canvas.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    notePresence({ cursor: { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height } })
  }

  const selectedEdge = edges.find((edge) => selected?.kind === 'edge' && edge.id === selected.id)

  return (
    <div className="work-map-wrap">
      <div className="work-bar">
        {SHAPES.map((item) => <button key={item.shape} type="button" onClick={() => add(item.shape)}>{item.label}</button>)}
        <button type="button" aria-pressed={connecting !== null} onClick={() => setConnecting(connecting === null ? '' : null)}>Connect</button>
        {selectedEdge && (
          <>
            <button type="button" onClick={() => commitEdges(edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, direction: NEXT[edge.direction] } : edge))}>Direction</button>
            <input aria-label="Connection label" value={selectedEdge.label ?? ''} onChange={(event) => commitEdges(edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, label: event.target.value } : edge))} />
          </>
        )}
      </div>
      <div ref={canvas} className="work-map" onPointerMove={onCanvasMove} onPointerDown={() => { setSelected(null); setConnecting(null) }}>
        <svg className="work-edges" aria-hidden>
          <defs>
            <marker id="map-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6" fill="none" stroke="currentColor" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = place(nodes, edge.sourceId, live, peers)
            const to = place(nodes, edge.targetId, live, peers)
            if (!from || !to) return null
            const x1 = from.x + from.width / 2
            const y1 = from.y + from.height / 2
            const x2 = to.x + to.width / 2
            const y2 = to.y + to.height / 2
            return (
              <g key={edge.id} onPointerDown={(event) => { event.stopPropagation(); setSelected({ kind: 'edge', id: edge.id }) }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={selected?.id === edge.id ? 'is-selected' : undefined} markerEnd={edge.direction === 'forward' || edge.direction === 'both' ? 'url(#map-arrow)' : undefined} markerStart={edge.direction === 'back' || edge.direction === 'both' ? 'url(#map-arrow)' : undefined} />
                {edge.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2}>{edge.label}</text>}
              </g>
            )
          })}
        </svg>
        {nodes.map((node) => {
          const shown = place(nodes, node.id, live, peers) ?? node
          const who = peers.find((peer) => peer.drag?.nodeId === node.id || (peer.focus?.kind === 'node' && peer.focus.id === node.id))
          return (
            <div
              key={node.id}
              className="work-node"
              data-shape={node.shape}
              data-selected={selected?.kind === 'node' && selected.id === node.id ? '' : undefined}
              style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
              onPointerDown={(event) => {
                event.stopPropagation()
                pick(node.id)
                if (connecting !== null) return
                drag(event.currentTarget, event, node, 'move', (next) => { liveRef.current = next; setLive(next); notePresence({ drag: next, activity: 'editing', focus: { kind: 'node', id: node.id } }) }, () => finish(node.id))
              }}
            >
              {who && <span className="work-node-who">{who.name}</span>}
              <input
                aria-label="Shape text"
                value={node.text}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => commitNodes(nodes.map((item) => item.id === node.id ? { ...item, text: event.target.value } : item))}
              />
              <button type="button" className="work-resize" aria-label="Resize" onPointerDown={(event) => {
                event.stopPropagation()
                drag(event.currentTarget, event, shown, 'resize', (next) => { liveRef.current = next; setLive(next); notePresence({ drag: next }) }, () => finish(node.id))
              }} />
            </div>
          )
        })}
        {peers.map((peer) => peer.cursor && (
          <span key={peer.clientId} className="work-cursor" style={{ left: `${peer.cursor.x * 100}%`, top: `${peer.cursor.y * 100}%` }}>{peer.name}</span>
        ))}
      </div>
    </div>
  )

  function finish(id: string) {
    const next = liveRef.current
    setLive(null)
    liveRef.current = null
    notePresence({ drag: null, activity: 'viewing' })
    if (!next || next.nodeId !== id) return
    commitNodes((doc.nodes ?? []).map((node) => node.id === id ? { ...node, x: next.x, y: next.y, width: next.width, height: next.height } : node))
  }
}

function place(nodes: MapNode[], id: string, live: Drag | null, peers: ReturnType<typeof usePeers>) {
  const node = nodes.find((item) => item.id === id)
  if (!node) return null
  if (live?.nodeId === id) return { ...node, ...live }
  const remote = peers.find((peer) => peer.drag?.nodeId === id)?.drag
  return remote ? { ...node, ...remote } : node
}

function drag(handle: HTMLElement, event: ReactPointerEvent, node: MapNode | Drag, mode: 'move' | 'resize', onMove: (next: Drag) => void, onUp: () => void) {
  const origin = { x: event.clientX, y: event.clientY, node: { nodeId: 'nodeId' in node ? node.nodeId : node.id, x: node.x, y: node.y, width: node.width, height: node.height } }
  handle.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - origin.x
    const dy = ev.clientY - origin.y
    onMove(mode === 'move'
      ? { ...origin.node, x: Math.max(0, origin.node.x + dx), y: Math.max(0, origin.node.y + dy) }
      : { ...origin.node, width: Math.max(72, origin.node.width + dx), height: Math.max(48, origin.node.height + dy) })
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    onUp()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}
