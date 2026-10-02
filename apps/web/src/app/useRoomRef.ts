import { useQuery } from '@tanstack/react-query'
import { getApiClient, ApiError, uploadMedia } from '@project/sdk'
import { titleCard } from '../utils/thumbnail'

// DEV-ONLY resolver for the room segment of /room/:ref.
//   /room/demo       → the shared public "OPEN CHANNEL" room (created on first visit)
//   /room/<id>?invite=CODE → joins the private room, then uses <id>
//   /room/<id>       → <id> as-is (public rooms are readable; posting auto-joins)
// ## Phase 2: drop "demo" once Home is the only way into rooms.
const DEMO_TITLE = 'OPEN CHANNEL'

export function useRoomRef(ref: string) {
  const invite = new URLSearchParams(window.location.search).get('invite') ?? undefined
  return useQuery({
    queryKey: ['room-ref', ref, invite ?? null],
    staleTime: Infinity,
    queryFn: async (): Promise<string> => {
      const client = getApiClient()
      if (ref === 'demo') {
        const found = await client.GET('/rooms', { params: { query: { q: DEMO_TITLE, limit: 20 } } })
        const existing = found.data?.data.find((r) => r.title === DEMO_TITLE)
        if (existing) return existing.id
        const card = await titleCard(DEMO_TITLE)
        if (!card) throw new Error('Unable to draw the demo thumbnail')
        const thumbnail = await uploadMedia({ file: card, type: 'image', name: 'thumbnail.jpg' })
        const created = await client.POST('/rooms', {
          body: { title: DEMO_TITLE, description: 'The shared demo conversation.', thumbnailId: thumbnail.id },
        })
        if (!created.data) throw new ApiError(created.response.status, 'Unable to create demo room')
        return created.data.data.id
      }
      if (invite) {
        const joined = await client.POST('/rooms/{roomId}/join', { params: { path: { roomId: ref } }, body: { inviteCode: invite } })
        if (!joined.data) throw new ApiError(joined.response.status, 'Invite is invalid or expired')
      }
      return ref
    },
  })
}
