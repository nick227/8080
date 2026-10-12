// Live remains deliberately closed while the personal cost limits are undecided.
// Neither a room role, staff role, nor a complimentary grant bypasses this gate.
// Re-enabling requires durable quotas and active-session enforcement, not a flag.
import { httpError } from '../lib/errors'
import { RoomService } from './RoomService'
import { activeIdentity } from './authorization/identity'
import { entitlements } from './admin/entitlements'

const rooms = new RoomService()
export async function liveToken(userId: string, roomId: string): Promise<never> {
  await activeIdentity(userId)
  await rooms.viewable(userId, roomId)
  const access = await entitlements(userId)
  if (access.tier !== 'premium') throw httpError(403, 'Premium is required to join Live, including as a viewer', 'PREMIUM_REQUIRED')
  throw httpError(503, access.liveUnavailableReason, 'LIVE_NOT_ENABLED')
}
