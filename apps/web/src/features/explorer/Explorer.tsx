import { useMemo } from 'react'
import type { Item as ItemType } from '../../api/types'
import { Panel } from '../../components/Panel'
import { useData } from '../../state/data'
import { useUI } from '../../state/ui'
import { motion } from 'motion/react'
import { ActiveMediaStage } from './ActiveMediaStage'
import { ResponseStrip } from './ResponseStrip'
import { ParentContext } from './ParentContext'
import './explorer.css'

export function Explorer({ items, onReply }: {
  items: ItemType[]
  onReply: (id: string) => void
  onSend: (input: any) => Promise<void>
}) {
  const data = useData()
  const ui = useUI()
  
  const root = useMemo(() => items.find(i => !i.parentId), [items])
  const activeId = ui.activeItemId || root?.id
  const activeItem = useMemo(() => activeId ? data.itemsById[activeId] : null, [activeId, data.itemsById])
  
  const childrenList = useMemo(() => {
    if (!activeId) return []
    return (data.childrenById[activeId] ?? [])
      .map(id => data.itemsById[id])
      .filter((i): i is ItemType => !!i && (!!i.text || !!i.media?.length))
      .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)
  }, [activeId, data.childrenById, data.itemsById])

  const parentItem = useMemo(() => {
    if (!activeItem?.parentId) return null
    return data.itemsById[activeItem.parentId] ?? null
  }, [activeItem, data.itemsById])

  const handleSelectResponse = (id: string) => {
    ui.startPlayback(id, 'branch')
  }

  const handleGoBack = () => {
    if (parentItem) {
      ui.startPlayback(parentItem.id, 'branch')
    }
  }

  const handleEnded = () => {
    setTimeout(() => {
      if (ui.state === 'playback' && ui.activeItemId === activeItem?.id) {
        ui.setIdle()
      }
    }, 1500)
  }

  if (!activeItem) return null

  return (
    <Panel as={motion.section} className="explorer" aria-live="polite">
      <div className="explorer-layout">
        <ParentContext parent={parentItem} onBack={handleGoBack} />
        <ActiveMediaStage 
          item={activeItem} 
          onReply={() => onReply(activeItem.id)}
          onEnded={handleEnded}
        />
        {childrenList.length > 0 && (
          <ResponseStrip 
            childrenList={childrenList} 
            onSelect={handleSelectResponse} 
          />
        )}
      </div>
    </Panel>
  )
}
