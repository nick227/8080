const KEY = 'vc-dataset-contacts'

export type DatasetColumn = {
  key: string
  label: string
  type: 'text' | 'number'
  editable: boolean
}

export type DatasetRow = {
  id: string
  version: number
  cells: Record<string, string>
}

export type EditInput = {
  rowId: string
  field: string
  value: string
  expectedVersion: number
  idempotencyKey: string
  sourceDocumentId: string
}

export type EditResult =
  | { status: 'updated'; row: DatasetRow }
  | { status: 'conflict'; current: DatasetRow; proposed: string }
  | { status: 'failed'; message: string }

export type DatasetAdapter = {
  key: string
  version: number
  description: string
  rowGrain: string
  columns: DatasetColumn[]
  load: () => DatasetRow[]
  edit: (input: EditInput) => EditResult
}

const columns: DatasetColumn[] = [
  { key: 'name', label: 'Name', type: 'text', editable: true },
  { key: 'title', label: 'Job', type: 'text', editable: true },
  { key: 'email', label: 'Email', type: 'text', editable: false },
]

const sample: DatasetRow[] = [
  ['Ada Lovelace', 'Analyst', 'ada@example.com'],
  ['Grace Hopper', 'Engineer', 'grace@example.com'],
  ['Katherine Johnson', 'Navigator', 'katherine@example.com'],
  ['Margaret Hamilton', 'Lead', 'margaret@example.com'],
  ['Radia Perlman', 'Architect', 'radia@example.com'],
  ['Barbara Liskov', 'Researcher', 'barbara@example.com'],
  ['Frances Allen', 'Compiler', 'frances@example.com'],
  ['Adele Goldberg', 'Designer', 'adele@example.com'],
].map(([name, title, email], index) => ({
  id: `contact-${index + 1}`,
  version: 1,
  cells: { name, title, email },
}))

let rows = readRows()
localStorage.setItem(KEY, JSON.stringify(rows))
let snapshot = rows.slice()
const listeners = new Set<() => void>()
const seen = new Map<string, EditResult>()
const clientId = crypto.randomUUID()
let applying = false
const channel = new BroadcastChannel('vc-dataset')

channel.onmessage = (event: MessageEvent<{ clientId: string; row: DatasetRow }>) => {
  if (event.data.clientId === clientId) return
  applying = true
  replace(event.data.row)
  applying = false
}

function readRows() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return sample.map((row) => ({ ...row, cells: { ...row.cells } }))
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return sample.map((row) => ({ ...row, cells: { ...row.cells } }))
    return parsed as DatasetRow[]
  } catch {
    return sample.map((row) => ({ ...row, cells: { ...row.cells } }))
  }
}

function emit() {
  snapshot = rows.slice()
  localStorage.setItem(KEY, JSON.stringify(rows))
  listeners.forEach((listener) => listener())
}

function replace(row: DatasetRow) {
  const index = rows.findIndex((item) => item.id === row.id)
  if (index < 0) return
  rows[index] = row
  emit()
}

export function subscribeDataset(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDatasetRows() {
  return snapshot
}

export const contactsAdapter: DatasetAdapter = {
  key: 'contacts',
  version: 1,
  description: 'Live contacts',
  rowGrain: 'contact',
  columns,
  load: getDatasetRows,
  edit(input) {
    const prior = seen.get(input.idempotencyKey)
    if (prior) return prior
    const column = columns.find((item) => item.key === input.field)
    const current = rows.find((item) => item.id === input.rowId)
    let result: EditResult
    if (!column || !current) result = { status: 'failed', message: 'Unknown contact field' }
    else if (!column.editable) result = { status: 'failed', message: `${column.label} is read only` }
    else if (current.version !== input.expectedVersion) result = { status: 'conflict', current, proposed: input.value }
    else {
      const row = { ...current, version: current.version + 1, cells: { ...current.cells, [input.field]: input.value } }
      replace(row)
      if (!applying) channel.postMessage({ clientId, row, sourceDocumentId: input.sourceDocumentId })
      result = { status: 'updated', row }
    }
    seen.set(input.idempotencyKey, result)
    return result
  },
}

export function datasetAdapter(key: string) {
  return key === contactsAdapter.key ? contactsAdapter : null
}
