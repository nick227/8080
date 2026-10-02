import { ApiError, createYouTubeMedia, getApiClient, uploadMedia } from '@project/sdk'
import { useUI } from '../state/ui'
import { isLocalMedia, isYouTubeDraft, type SendInput } from './types'

// Turns what the Instrument hands over into server media ids: local captures/files
// are uploaded, YouTube drafts are registered (never downloaded), existing media
// passes through. Shared by every send path (room composer, Home).
export async function resolveMediaIds(media: SendInput['media']): Promise<string[]> {
  return Promise.all(
    (media ?? []).map(async (m) => {
      if (isYouTubeDraft(m)) return (await createYouTubeMedia({ url: m.url, durationMs: m.durationMs, embeddable: m.embeddable })).id
      if (isLocalMedia(m)) return (await uploadMedia({ file: m.file, type: m.type, name: m.name, duration: m.duration })).id
      return m.id
    }),
  )
}

// When the UI is in a reply context (REPLY / REPLY HERE → compose/record/review), a
// send is a reply to that item — wherever the record surface lives (room or Home).
// Returns false when this isn't a reply, so the caller does its normal send.
const REPLY_STATES = new Set(['replying', 'composing', 'recording', 'reviewing'])
export async function replyFromUIState(input: SendInput): Promise<boolean> {
  const ui = useUI.getState()
  if (!REPLY_STATES.has(ui.state) || !ui.activeItemId) return false
  const mediaIds = await resolveMediaIds(input.media)
  const res = await getApiClient().POST('/items/{itemId}/replies', {
    params: { path: { itemId: ui.activeItemId } },
    body: {
      text: input.text,
      mediaIds: mediaIds.length ? mediaIds : undefined,
      ...(ui.replyAnchorMs != null ? { anchorStartMs: ui.replyAnchorMs } : {}), // the moment captured at REPLY HERE
    },
  })
  if (res.error) {
    const body = res.error as { error?: string }
    throw new ApiError(res.response.status, body.error ?? 'Failed to send reply')
  }
  return true
}
