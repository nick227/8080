import type { Item as ItemType } from '../../api/types'
import { Control } from '../../components/Control'
import { formatMoment } from '../../utils/anchor'

export function ParentContext({ parent, onBack }: { parent: ItemType | null, onBack: () => void }) {
  if (!parent) return null
  
  // Try to find the title or text of the parent
  const title = parent.media?.[0]?.title || parent.media?.[0]?.name || parent.text || 'MEDIA'
  const time = parent.anchorStartMs != null ? ` AT ${formatMoment(parent.anchorStartMs)}` : ''
  
  return (
    <div className="parent-context">
      <Control onClick={onBack} aria-label="Go back to parent">
        ← RE: {title.length > 30 ? title.slice(0, 30) + '...' : title}{time}
      </Control>
    </div>
  )
}
