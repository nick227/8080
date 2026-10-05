import type { ComponentType } from 'react'
import { capabilities, type DocumentRecord, type EditorCapabilities } from '../types'
import { BlockEditor } from './BlockEditor'
import { GridEditor } from './GridEditor'
import { MapEditor } from './MapEditor'

export type EditorProps = { doc: DocumentRecord }

export type EditorAdapter = {
  surface: DocumentRecord['surface']
  capabilities: (doc: DocumentRecord) => EditorCapabilities
  Editor: ComponentType<EditorProps>
}

export const adapters: EditorAdapter[] = [
  { surface: 'blocks', capabilities, Editor: BlockEditor },
  { surface: 'mental_map', capabilities, Editor: MapEditor },
  { surface: 'grid', capabilities, Editor: GridEditor },
]

export function adapterFor(doc: DocumentRecord) {
  const adapter = adapters.find((item) => item.surface === doc.surface)
  if (!adapter) throw new Error(`No editor for ${doc.surface}`)
  return adapter
}
