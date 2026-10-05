import type { Block, SectionLevel } from '../types'

export type ShownLevel = 'body' | 'h2' | 'h1'

export const LEVELS: { id: ShownLevel; label: string; name: string }[] = [
  { id: 'body', label: 'x1', name: 'Body' },
  { id: 'h2', label: 'x2', name: 'Heading' },
  { id: 'h1', label: 'x3', name: 'Title' },
]

export function sectionLevel(block: Block): ShownLevel {
  const level: SectionLevel = block.level ?? (block.type === 'title' ? 'h1' : 'body')
  if (level === 'h1') return 'h1'
  if (level === 'h2' || level === 'h3') return 'h2'
  return 'body'
}
