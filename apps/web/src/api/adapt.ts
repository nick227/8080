// SDK (API contract) shapes → the frontend's own types (null → undefined).
// The one place server data is reshaped for views, features and state.
import type { Item as SdkItem, Media as SdkMedia } from '@project/sdk'
import type { Item, Media } from './types'

export function toMedia(m: SdkMedia): Media {
  return {
    id: m.id,
    type: m.type,
    url: m.url,
    duration: m.duration ?? undefined,
    poster: m.poster ?? undefined,
    name: m.name ?? undefined,
    mimeType: m.mimeType,
    size: m.size,
    source: m.source,
    externalId: m.externalId ?? undefined,
    title: m.title ?? undefined,
    embeddable: m.embeddable,
  }
}

export function toItem(i: SdkItem): Item {
  return {
    id: i.id,
    number: i.number,
    messageId: i.messageId,
    parentId: i.parentId ?? undefined,
    anchorStartMs: i.anchorStartMs ?? undefined,
    author: { id: i.message.author.id, name: i.message.author.name },
    text: i.message.text ?? undefined,
    media: i.message.media.length ? i.message.media.map(toMedia) : undefined,
    reactions: i.reactions.map(({ type, count, reacted }) => ({ type, count, reacted })),
    createdAt: i.createdAt,
  }
}

export function toRiverItem(i: any): Item & { roomId: string; roomTitle: string; replyCount: number } {
  return {
    ...toItem(i),
    roomId: i.roomId,
    roomTitle: i.roomTitle,
    replyCount: i.replyCount,
  }
}
