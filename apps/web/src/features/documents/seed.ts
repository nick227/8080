import type { DocumentRecord, MapEdge, MapNode, SheetColumn, SheetRow } from './types'

function column(id: string, name: string): SheetColumn {
  return { id, name }
}

function row(id: string, cells: Record<string, string>): SheetRow {
  return { id, cells }
}

function node(id: string, text: string, x: number, y: number, shape: MapNode['shape']): MapNode {
  return { id, shape, x, y, width: 148, height: 72, text }
}

function edge(id: string, sourceId: string, targetId: string): MapEdge {
  return { id, sourceId, targetId, direction: 'forward' }
}

export function starterDocs(owner: string): DocumentRecord[] {
  const now = Date.now()
  return [
    {
      id: 'doc-brief',
      title: 'Project brief',
      surface: 'blocks',
      ownerName: owner,
      updatedAt: now,
      roomIds: [],
      blocks: [
        { id: 'b-title', type: 'section', level: 'h1', text: 'Project brief' },
        { id: 'b-body', type: 'section', level: 'body', text: 'What we are doing, and why it matters.' },
      ],
    },
    {
      id: 'doc-map',
      title: 'Campaign map',
      surface: 'mental_map',
      ownerName: owner,
      updatedAt: now,
      roomIds: [],
      nodes: [
        node('n-audience', 'Audience', 32, 48, 'round'),
        node('n-message', 'Message', 240, 48, 'rect'),
        node('n-next', 'Next step', 136, 180, 'diamond'),
      ],
      edges: [edge('e-1', 'n-audience', 'n-message'), edge('e-2', 'n-message', 'n-next')],
    },
    {
      id: 'doc-plan',
      title: 'Planning table',
      surface: 'grid',
      ownerName: owner,
      updatedAt: now,
      roomIds: [],
      sheet: {
        mode: 'sheet',
        columns: [column('note', 'Note'), column('owner', 'Owner'), column('status', 'Status')],
        rows: [
          row('r1', { note: 'Write the brief', owner: 'Ada', status: 'Open' }),
          row('r2', { note: 'Sketch the map', owner: 'Grace', status: 'Open' }),
          row('r3', { note: 'Review contacts', owner: 'Ada', status: 'Waiting' }),
        ],
      },
    },
    {
      id: 'doc-contacts',
      title: 'Contacts',
      surface: 'grid',
      ownerName: owner,
      updatedAt: now,
      roomIds: [],
      sheet: { mode: 'dataset', dataset: 'contacts', columns: ['name', 'title', 'email'] },
    },
  ]
}

export function blankDoc(surface: DocumentRecord['surface'], owner: string, dataset?: string): DocumentRecord {
  const id = crypto.randomUUID()
  const now = Date.now()
  const base = { id, title: surface === 'blocks' ? 'Untitled' : surface === 'mental_map' ? 'Untitled map' : 'Untitled sheet', surface, ownerName: owner, updatedAt: now, roomIds: [] as string[] }
  if (surface === 'blocks') return { ...base, blocks: [{ id: crypto.randomUUID(), type: 'section', level: 'body', text: '' }] }
  if (surface === 'mental_map') return { ...base, nodes: [], edges: [] }
  if (dataset) return { ...base, title: 'Contacts', sheet: { mode: 'dataset', dataset, columns: ['name', 'title', 'email'] } }
  return {
    ...base,
    sheet: {
      mode: 'sheet',
      columns: [column('note', 'Note'), column('owner', 'Owner'), column('status', 'Status')],
      rows: [row(crypto.randomUUID(), { note: '', owner: '', status: '' })],
    },
  }
}
