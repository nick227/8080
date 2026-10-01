import { useState } from 'react'
import { useMyRooms, useShareMessage } from '@project/sdk'
import { Panel } from './Panel'
import { Stack } from './Stack'
import { Label } from './Label'
import { Control } from './Control'
import { useRoomRef } from '../app/useRoomRef'

type Props = {
  messageId: string
  onClose: () => void
}

export function ShareMenu({ messageId, onClose }: Props) {
  const currentRoomId = useRoomRef(window.location.pathname.split('/').pop() || '').data
  const { data: myRoomsPage } = useMyRooms()
  const myRooms = myRoomsPage?.pages.flatMap((p) => p.data) || []
  const share = useShareMessage()

  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleShare = async () => {
    if (selected.size === 0) return
    try {
      await share.mutateAsync({ messageId, roomIds: Array.from(selected) })
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to share message')
    }
  }

  return (
    <Stack className="share-menu" gap="small" style={{ marginTop: 16, paddingLeft: 12, borderLeft: '1px solid var(--line)' }}>
      <Label variant="eyebrow" style={{ opacity: 0.6 }}>SHARE TO ROOMS</Label>
      <Stack gap="small">
        {myRooms.map((room) => {
          const isCurrent = room.id === currentRoomId
          const isSelected = selected.has(room.id)
          return (
            <Control
              key={room.id}
              onClick={() => !isCurrent && toggle(room.id)}
              disabled={isCurrent}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                textAlign: 'left',
                opacity: isCurrent ? 0.3 : 1,
                padding: '4px 0',
              }}
            >
              <span>
                <span style={{ marginRight: 8 }}>{isSelected ? '✓' : '○'}</span>
                {room.title}
              </span>
              <Label variant="caption" style={{ opacity: 0.5 }}>
                {room.visibility.toUpperCase()}
              </Label>
            </Control>
          )
        })}
      </Stack>
      
      <Stack direction="row" justify="between" style={{ marginTop: 8 }}>
        <Control onClick={onClose} style={{ opacity: 0.6 }}>CANCEL</Control>
        <Control 
          onClick={handleShare}
          disabled={selected.size === 0 || share.isPending}
        >
          {share.isPending ? 'SHARING...' : selected.size > 0 ? `SHARE TO ${selected.size} ROOM${selected.size > 1 ? 'S' : ''}` : 'SHARE'}
        </Control>
      </Stack>
    </Stack>
  )
}
