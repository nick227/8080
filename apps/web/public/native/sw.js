// 8080 mobile app service worker (scope /native/). Deliberately caches nothing:
// pages and API responses always come from the network, so a deploy is live on
// the next load and no workspace data is stored on the device.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Web Push (server: services/push.ts). Payload: { title, body, tag, url }.
// Always shown, even with the app open: iOS revokes push for silent deliveries.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: event.data && event.data.text() } }
  const title = data.title || '8080'
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      icon: '/native/icon-192.png',
      badge: '/native/icon-192.png',
      data: { url: data.url || '/native/' },
    }),
    // An open app refreshes its inbox right away.
    self.clients.matchAll({ type: 'window' }).then((list) => list.forEach((client) => client.postMessage({ type: 'push' }))),
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/native/', self.location.origin)
  // Only ever open our own app pages.
  const url = target.origin === self.location.origin && target.pathname.startsWith('/native/') ? target.href : new URL('/native/', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    const open = list.find((client) => new URL(client.url).pathname.startsWith('/native/'))
    if (open) {
      const navigated = await open.navigate(url).catch(() => null)
      return (navigated || open).focus()
    }
    return self.clients.openWindow(url)
  }))
})
