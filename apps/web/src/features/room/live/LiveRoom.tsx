import { useEffect, useState, type ReactNode } from 'react'
import { RoomContext, useRemoteParticipants } from '@livekit/components-react'
import { Room, RoomEvent, Track, type LocalTrackPublication } from 'livekit-client'
import { useLiveToken } from '@project/sdk'
import { useLocalLive } from './localLive'

// One LiveKit connection per room page, shared by every tile and view (Grid,
// Full, other desks) — mounted around the whole room shell, adding no element.
// The app's room authorization decides through the token (GET /rooms/:id/live-token);
// without one (no live video configured, or no access) the room works as before.
export function LiveRoom({ roomId, children }: { roomId: string | undefined; children: ReactNode }) {
  const token = useLiveToken(roomId)
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }))
  const data = token.data
  const ready = !!data

  // Connect once per room. LiveKit refreshes the token of a connected client, so a
  // refetched token must not tear the connection down and rebuild it.
  useEffect(() => {
    if (!ready || !token.data) return
    let cancelled = false
    room.connect(token.data.url, token.data.token, { autoSubscribe: true }).catch((error) => {
      if (!cancelled) console.warn('Live video unavailable:', error)
    })
    return () => {
      cancelled = true
      void room.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, ready, roomId])

  // Leaving the room page ends this person's live broadcast.
  useEffect(() => () => useLocalLive.getState().stop(), [roomId])

  if (!data) return <>{children}</>
  return (
    <RoomContext.Provider value={room}>
      {data.canPublish && <Publisher room={room} />}
      {children}
    </RoomContext.Provider>
  )
}

// Publishes the local live track while there is someone to see it (no cost for a
// lonely broadcaster); unpublishes when live stops or the last viewer leaves.
function Publisher({ room }: { room: Room }) {
  const track = useLocalLive((s) => s.track)
  const kind = useLocalLive((s) => s.kind)
  const audience = useRemoteParticipants().length > 0
  const [connected, setConnected] = useState(room.state === 'connected')

  useEffect(() => {
    const update = () => setConnected(room.state === 'connected')
    room.on(RoomEvent.ConnectionStateChanged, update)
    return () => { room.off(RoomEvent.ConnectionStateChanged, update) }
  }, [room])

  useEffect(() => {
    if (!connected || !track || !audience || kind === 'off') return
    let publication: LocalTrackPublication | null = null
    let cancelled = false
    const source = kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera
    room.localParticipant.publishTrack(track, { name: kind, source }).then((p) => {
      publication = p
      if (cancelled) void room.localParticipant.unpublishTrack(track, false)
    }).catch((error) => console.warn('Couldn’t publish live video:', error))
    return () => {
      cancelled = true
      // false: the capture (camera/compositor/screen) belongs to the live session, not LiveKit.
      if (publication) void room.localParticipant.unpublishTrack(track, false).catch(() => {})
    }
  }, [room, connected, track, kind, audience])

  return null
}
