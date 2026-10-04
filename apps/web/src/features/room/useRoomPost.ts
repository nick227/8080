import { useState } from 'react'
import { useSession, useSendMessage, useReplyToItem } from '@project/sdk'
import { findYouTubeVideoId, youTubeThumbnailUrl } from '@project/shared'
import { useUI } from '../../state/ui'
import { resolveMediaIds } from '../../api/sendMedia'
import { isLocalMedia, isYouTubeDraft, type SendInput } from '../../api/types'
import type { StreamMedia } from './ChatStream'

export type PendingPost = {
  id: string
  parentId?: string
  author: string
  avatarUrl?: string
  text?: string
  media: StreamMedia[]
  previewUrl?: string
  status: 'sending' | 'failed'
  chat?: boolean
  input: SendInput
}

const REPLY_STATES = new Set(['replying', 'composing', 'recording', 'reviewing'])

function previewMedia(input: SendInput): { media: StreamMedia[]; previewUrl?: string } {
  const first = input.media?.[0]
  if (!first) return { media: [] }
  if (isLocalMedia(first)) {
    const previewUrl = URL.createObjectURL(first.file)
    return {
      previewUrl,
      media: [{ type: first.type, url: previewUrl, poster: first.type === 'video' || first.type === 'image' ? previewUrl : undefined, name: first.name }],
    }
  }
  if (isYouTubeDraft(first)) {
    const id = findYouTubeVideoId(first.url)?.id
    return { media: [{ type: 'video', url: first.url, poster: id ? youTubeThumbnailUrl(id) : undefined, title: 'YouTube' }] }
  }
  return { media: [{ type: first.type, url: first.url, poster: first.poster, title: first.title, name: first.name }] }
}

export function useRoomPost(roomId: string | undefined) {
  const session = useSession()
  const sendMessage = useSendMessage(roomId ?? '')
  const replyToItem = useReplyToItem(roomId ?? '')
  const [pending, setPending] = useState<PendingPost[]>([])
  const me = session.data?.data.displayName ?? 'You'
  const meAvatar = session.data?.data.avatarUrl ?? undefined

  const drop = (id: string) => {
    setPending((prev) => {
      const found = prev.find((post) => post.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((post) => post.id !== id)
    })
  }

  const post = async (input: SendInput, retryId?: string, options?: { chat?: boolean }) => {
    const existing = retryId ? pending.find((item) => item.id === retryId) : undefined
    const chat = existing?.chat === true || options?.chat === true
    const ui = useUI.getState()
    const parentId = chat ? undefined : (REPLY_STATES.has(ui.state) ? ui.activeItemId : undefined)
    const id = existing?.id ?? `pending-${crypto.randomUUID()}`
    const shown = existing ?? { id, parentId, author: me, avatarUrl: meAvatar, text: input.text, ...previewMedia(input), status: 'sending' as const, chat, input }

    setPending((prev) => {
      const without = prev.filter((item) => item.id !== id)
      return [...without, { ...shown, status: 'sending', parentId: existing?.parentId ?? parentId, input }]
    })

    try {
      const mediaIds = await resolveMediaIds(input.media)
      const text = input.text
      const ids = mediaIds.length ? mediaIds : undefined
      const target = existing?.parentId ?? parentId
      if (target) await replyToItem.mutateAsync({ itemId: target, text, mediaIds: ids })
      else await sendMessage.mutateAsync({ text, mediaIds: ids, ...(chat ? { chat: true } : {}) })
      drop(id)
      if (!chat) useUI.getState().setIdle()
      return true
    } catch (error) {
      setPending((prev) => prev.map((item) => item.id === id ? { ...item, status: 'failed' } : item))
      const message = error instanceof Error ? error.message : 'Send failed'
      useUI.getState().setError(message)
      return false
    }
  }

  return { pending, post, meId: session.data?.data.id, meName: me, meAvatar, meGuest: session.data?.data.isGuest ?? true }
}
