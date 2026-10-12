import { getApiClient, unwrap } from '../client'

// Web Push registration for the /native/ app. Plain calls: the page drives them from
// the browser's own permission and PushManager state, which has no query to cache.

export async function getPushPublicKey() {
  return unwrap(await getApiClient().GET('/push/config')).data.publicKey
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
