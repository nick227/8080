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

// Adapted once per SDK object. The SDK cache keeps unchanged items' identity across
// updates (only the changed page is copied), so unchanged items keep theirs here too
// and memoised views can skip them. Adapted items are never mutated.
const adapted = new WeakMap<SdkItem, Item>()

export function toItem(i: SdkItem): Item {
  const cached = adapted.get(i)
  if (cached) return cached
  const item: Item = {
    id: i.id,
    number: i.number,
    messageId: i.messageId,
    parentId: i.parentId ?? undefined,
    anchorStartMs: i.anchorStartMs ?? undefined,
    chat: i.chat || undefined,
    author: {
      id: i.message.author.id,
      name: i.message.author.name,
      avatarUrl: i.message.author.avatarUrl ?? undefined,
      kind: i.message.author.kind,
      tag: i.message.author.tag ?? undefined,
    },
    text: i.message.text ?? undefined,
    media: i.message.media.length ? i.message.media.map(toMedia) : undefined,
    actions: i.message.actions
      ? { mode: i.message.actions.mode, options: i.message.actions.options, forUserId: i.message.actions.forUserId ?? undefined }
      : undefined,
    choice: i.message.choice ?? undefined,
    links: i.message.links.length ? i.message.links : undefined,
    proposal: i.proposal ?? undefined,
    reactions: i.reactions.map(({ type, count, reacted }) => ({ type, count, reacted })),
    createdAt: i.createdAt,
  }
  adapted.set(i, item)
  return item
}
