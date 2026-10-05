import type { Block, SectionLevel } from '../types'

export const LEVELS: { id: SectionLevel; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'h3', label: 'Small' },
  { id: 'h2', label: 'Heading' },
  { id: 'h1', label: 'Title' },
]

export function sectionLevel(block: Block): SectionLevel {
  if (block.level) return block.level
  if (block.type === 'title') return 'h1'
  return 'body'
}
