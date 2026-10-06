import type { CellType, CellValue } from '@project/shared'
// external = a Google Doc/Sheet link: opens in a new tab, never in an editor.
export type Surface = 'blocks' | 'mental_map' | 'grid' | 'external'

// One section holds the writing and, optionally, one attachment.
// title / paragraph / media remain so documents saved before this still open.
export type SectionLevel = 'body' | 'h3' | 'h2' | 'h1'

export type Block = {
  id: string
  type: 'section' | 'title' | 'paragraph' | 'media'
  level?: SectionLevel
  text?: string
  mediaName?: string
  mediaKind?: 'image' | 'video' | 'audio' | 'file'
}

export type MapShape = 'rect' | 'round' | 'circle' | 'diamond'

export type MapNode = {
  id: string
  shape: MapShape
  x: number
  y: number
  width: number
  height: number
  text: string
  color?: string
}

export type EdgeDirection = 'forward' | 'back' | 'both' | 'none'
export type NubPos = 'top' | 'right' | 'bottom' | 'left'

export type MapEdge = {
  id: string
  sourceId: string
  targetId: string
  sourceNub?: NubPos
  targetNub?: NubPos
  label?: string
  direction: EdgeDirection
}

// Typed since A2 (doc/13 §12; packages/shared/src/sheetContent.ts): no type = text.
// Cells hold raw values — money in minor units, dates as YYYY-MM-DD.
export type SheetColumn = { id: string; name: string; type?: CellType; currency?: string; total?: 'sum' }

export type SheetRow = { id: string; cells: Record<string, CellValue> }

export type NativeSheet = { mode: 'sheet'; columns: SheetColumn[]; rows: SheetRow[] }

export type DatasetSheet = { mode: 'dataset'; dataset: string; columns: string[] }

// The shared registry entry behind a document (workspace mode). Identity and
// metadata are the server's; native content (blocks, map, blank sheets) is still
// stored in this browser until the native persistence slice (doc/10 §10) lands.
export type SharedInfo = {
  version: number
  ownerMemberId: string
  // native: content local · dataset: live canonical records · imported: rows from the
  // server, edits local · external: Google opens it
  kind: 'native' | 'dataset' | 'imported' | 'external'
  // Made from records by a recipe (doc/13 A1): shows where it came from and can be made again.
  generated?: boolean
  mine: boolean
  canEdit: boolean
  canManage: boolean
  externalUrl?: string
  externalFileId: string | null
}

export type DocumentRecord = {
  id: string
  title: string
  surface: Surface
  ownerName: string
  updatedAt: number
  roomIds: string[]
  blocks?: Block[]
  nodes?: MapNode[]
  edges?: MapEdge[]
  sheet?: NativeSheet | DatasetSheet
  // Present when the entry lives in the workspace registry
  shared?: SharedInfo
}

export type EditorCapabilities = {
  editContent: boolean
  editRecords: boolean
  attachMedia: boolean
  showNativePresence: boolean
}

export function capabilities(doc: DocumentRecord): EditorCapabilities {
  if (doc.surface === 'external') return { editContent: false, editRecords: false, attachMedia: false, showNativePresence: false }
  if (doc.surface === 'blocks') {
    return { editContent: true, editRecords: false, attachMedia: true, showNativePresence: true }
  }
  if (doc.surface === 'mental_map') {
    return { editContent: true, editRecords: false, attachMedia: false, showNativePresence: true }
  }
  const records = doc.sheet?.mode === 'dataset'
  return { editContent: !records, editRecords: records, attachMedia: false, showNativePresence: true }
}
