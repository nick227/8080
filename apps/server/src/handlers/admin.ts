import { adminSettings, changeStaff } from '../services/admin/settings'
import { linkCustomer, reconcileSubscription } from '../services/admin/stripeSync'
import { listAdminSubscriptions } from '../services/admin/billing'
import { randomUUID } from 'crypto'
import { authorize } from '../services/authorization'
import { adminCsrfToken, verifyAdminCsrf } from '../services/admin/csrf'
import { listAdminUsers, adminUserDetail, changeAdminUser, previewAdminUserChange } from '../services/admin/users'
import { entitlements } from '../services/admin/entitlements'

export async function getAdminSession(request: any, reply: any) {
  const actor = await authorize(request.user.id, { scope: 'platform', permission: 'users.read' })
  return reply.header('Cache-Control', 'no-store').send({ data: { role: 'role' in actor ? actor.role : null, csrfToken: adminCsrfToken(request) } })
}
export async function getAdminUsers(request: any, reply: any) {
  return reply.header('Cache-Control', 'no-store').send(await listAdminUsers(request.user.id, request.query))
}
export async function getAdminUser(request: any, reply: any) {
  return reply.header('Cache-Control', 'no-store').send({ data: await adminUserDetail(request.user.id, request.params.userId) })
}
export async function updateAdminUser(request: any, reply: any) {
  verifyAdminCsrf(request)
  return reply.header('Cache-Control', 'no-store').send({ data: await changeAdminUser(request.user.id, request.params.userId, request.body, randomUUID()) })
}
export async function getMyEntitlements(request: any, reply: any) {
  return reply.header('Cache-Control', 'no-store').send({ data: await entitlements(request.user.id) })
}

export async function previewAdminChange(request: any, reply: any) {
  verifyAdminCsrf(request)
  return reply.header('Cache-Control', 'no-store').send({ data: await previewAdminUserChange(request.user.id, request.params.userId, request.body) })
}
export async function getAdminSubscriptions(request: any, reply: any) {
  return reply.header('Cache-Control', 'no-store').send(await listAdminSubscriptions(request.user.id, request.query))
}

export async function getAdminSettings(request: any, reply: any) {
  return reply.header('Cache-Control', 'no-store').send({ data: await adminSettings(request.user.id) })
}
export async function updateAdminStaff(request: any, reply: any) {
  verifyAdminCsrf(request)
  return reply.header('Cache-Control', 'no-store').send({ data: await changeStaff(request.user.id, request.params.userId, request.body, randomUUID()) })
}
export async function linkAdminCustomer(request: any, reply: any) {
  verifyAdminCsrf(request)
  return reply.header('Cache-Control', 'no-store').send({ data: await linkCustomer(request.user.id, request.params.userId, request.body, randomUUID()) })
}
export async function syncAdminSubscription(request: any, reply: any) {
  verifyAdminCsrf(request)
  return reply.header('Cache-Control', 'no-store').send({ data: await reconcileSubscription(request.user.id, request.params.subscriptionId, request.body, randomUUID()) })
}
