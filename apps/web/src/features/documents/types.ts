export type Surface = 'blocks' | 'mental_map' | 'grid'

export type Block = {
  id: string
  type: 'title' | 'paragraph' | 'media'
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
}

export type EdgeDirection = 'forward' | 'back' | 'both' | 'none'

export type MapEdge = {
  id: string
  sourceId: string
  targetId: string
  label?: string
  direction: EdgeDirection
}

export type SheetColumn = { id: string; name: string }

export type SheetRow = { id: string; cells: Record<string, string> }

export type NativeSheet = { mode: 'sheet'; columns: SheetColumn[]; rows: SheetRow[] }

export type DatasetSheet = { mode: 'dataset'; dataset: string; columns: string[] }

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
}

export type EditorCapabilities = {
  editContent: boolean
  editRecords: boolean
  attachMedia: boolean
  showNativePresence: boolean
}

export function capabilities(doc: DocumentRecord): EditorCapabilities {
  if (doc.surface === 'blocks') {
    return { editContent: true, editRecords: false, attachMedia: true, showNativePresence: true }
  }
  if (doc.surface === 'mental_map') {
    return { editContent: true, editRecords: false, attachMedia: false, showNativePresence: true }
  }
  const records = doc.sheet?.mode === 'dataset'
  return { editContent: !records, editRecords: records, attachMedia: false, showNativePresence: true }
}
