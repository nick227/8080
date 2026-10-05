// Live video in a room (LiveKit). The app's room authorization stays
// authoritative: a token is minted only for someone who may view the room, for
// that room only, and lives briefly (LiveKit refreshes it for a connected client;
// a reconnect asks us again). Live is broadcast only — async recordings still go
// through Chat and the item pipeline, never through LiveKit.
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { db } from '@project/db'
import { httpError } from '../lib/errors'
import { RoomService } from './RoomService'

const rooms = new RoomService()

export const LIVE_TOKEN_TTL_SECONDS = 10 * 60

export function liveConfig() {
  const url = process.env.LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null
}

export async function liveToken(userId: string, roomId: string) {
  // 404 for rooms the caller can't see — same rule as every other room read.
  await rooms.viewable(userId, roomId)
  const config = liveConfig()
  if (!config) throw httpError(503, 'Live video is not configured', 'LIVE_UNAVAILABLE')

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } })
  // People broadcast their camera or screen; bots and suspended accounts only watch.
  const canPublish = user.kind === 'human' && !user.suspendedAt

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id, // = the seat id on the room floor, so tiles match participants
    name: user.profile?.displayName ?? 'Guest',
    ttl: LIVE_TOKEN_TTL_SECONDS,
  })
  token.addGrant({
    room: roomId,
    roomJoin: true,
    canSubscribe: true,
    canPublish,
    canPublishSources: canPublish ? [TrackSource.CAMERA, TrackSource.SCREEN_SHARE] : [],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  })
  return {
    token: await token.toJwt(),
    url: config.url,
    room: roomId,
    canPublish,
    expiresAt: new Date(Date.now() + LIVE_TOKEN_TTL_SECONDS * 1000).toISOString(),
  }
}
