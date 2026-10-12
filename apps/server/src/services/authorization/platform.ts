import { db, type Prisma } from '@project/db'
import { forbidden } from '../../lib/errors'
import { activeIdentity } from './identity'

export type PlatformPermission = 'users.read' | 'users.manage' | 'billing.read' | 'billing.manage' | 'staff.manage' | 'limits.manage'
const permissions: Record<PlatformPermission, readonly string[]> = {
  'users.read': ['platform_admin', 'platform_owner'],
  'users.manage': ['platform_admin', 'platform_owner'],
  'billing.manage': ['platform_owner'],
  'billing.read': ['platform_admin', 'platform_owner'],
  'staff.manage': ['platform_owner'],
  'limits.manage': ['platform_owner'],
}
export async function authorizePlatform(userId: string, permission: PlatformPermission, client: Prisma.TransactionClient = db) {
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_ENABLED !== 'true') throw forbidden('Platform administration is not enabled')
  const user = await activeIdentity(userId, client)
  if (user.isGuest || user.kind !== 'human') throw forbidden('Platform staff access required')
  const staff = await client.platformStaff.findUnique({ where: { userId } })
  if (!staff || !permissions[permission]?.includes(staff.role)) throw forbidden('Platform staff access required')
  return { user, role: staff.role }
}
