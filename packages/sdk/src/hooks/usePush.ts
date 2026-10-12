import { useQuery } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'

// Web Push registration for the /native/ app. Plain calls: the page drives them from
// the browser's own permission and PushManager state, which has no query to cache.

/** The server's push key and how many devices get the caller's notifications. */
export async function getPushConfig() {
  return unwrap(await getApiClient().GET('/push/config')).data
}

export async function getPushPublicKey() {
  return (await getPushConfig()).publicKey
}

export async function savePushSubscription(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return unwrap(await getApiClient().POST('/push/subscriptions', {
    body: { endpoint: subscription.endpoint, keys: subscription.keys, userAgent: navigator.userAgent.slice(0, 400) },
  })).data
}

export async function removePushSubscription(endpoint: string) {
  const { error, response } = await getApiClient().DELETE('/push/subscriptions', { params: { query: { endpoint } } })
  if (error !== undefined && response.status !== 204) unwrap({ error, response })
}

export async function sendTestPush() {
  return unwrap(await getApiClient().POST('/push/test')).data
}

export type PushDiagnosticsQuery = { days?: number; status?: 'pending' | 'accepted' | 'displayed' | 'opened' | 'failed' | 'cancelled'; userId?: string; limit?: number }

/** Staff only: how far notifications get, and what failed. */
export function usePushDiagnostics(query: PushDiagnosticsQuery, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'push', 'deliveries', query],
    enabled,
    queryFn: async () => unwrap(await getApiClient().GET('/admin/push/deliveries', { params: { query } })).data,
    refetchInterval: 30_000,
  })
}
