import type { DocumentRecord } from './types'

export function markOf(doc: DocumentRecord) {
  if (doc.surface === 'blocks') return 'Document'
  if (doc.surface === 'mental_map') return 'Map'
  if (doc.surface === 'external') return doc.shared?.externalUrl?.includes('/spreadsheets/') ? 'Google Sheet' : 'Google Doc'
  if (doc.sheet?.mode === 'dataset') return 'Contacts'
  return 'Sheet'
}

export function whenLabel(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
