// 8080 mobile app service worker (scope /native/). Deliberately caches nothing:
// pages and API responses always come from the network, so a deploy is live on
// the next load and no workspace data is stored on the device.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
