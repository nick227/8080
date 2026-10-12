// Push notifications on this device: the browser's permission + PushManager
// subscription, mirrored to the server (services/push.ts). Only ever on request.
import { useCallback, useEffect, useState } from 'react'
import { getPushPublicKey, removePushSubscription, savePushSubscription, sendTestPush } from '@project/sdk'
import { isStandalone, platform } from './install'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
  // iOS/iPadOS 16.4+ offers Web Push only to an app added to the Home Screen.
  if (platform() === 'ios' && !isStandalone()) return 'needs-install'
  return capable ? 'ok' : 'unsupported'
}

async function registration() {
  // Registered by NativeApp; `ready` waits for it to activate.
  return navigator.serviceWorker.ready
}

function keyBytes(base64url: string) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function toTarget(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  return { endpoint: json.endpoint, keys: json.keys }
}

export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null
  return (await registration()).pushManager.getSubscription()
}

/** Forget this device (sign-out, or turning notifications off). */
export async function disablePush() {
  const sub = await currentSubscription().catch(() => null)
  if (!sub) return
  await removePushSubscription(sub.endpoint).catch(() => { /* the server forgets it on the next failed delivery */ })
  await sub.unsubscribe().catch(() => undefined)
}

export function usePush() {
  const support = pushSupport()
  const [permission, setPermission] = useState<NotificationPermission>(() => (typeof Notification === 'undefined' ? 'default' : Notification.permission))
  const [subscribed, setSubscribed] = useState<boolean | null>(support === 'ok' ? null : false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // On open: a device that is subscribed re-registers, so the server knows it belongs
  // to whoever is signed in now (and learns of a re-keyed subscription).
  useEffect(() => {
    if (support !== 'ok') return
    let live = true
    void (async () => {
      const sub = await currentSubscription().catch(() => null)
      if (sub && Notification.permission === 'granted') await savePushSubscription(toTarget(sub)).catch(() => undefined)
      if (live) setSubscribed(!!sub && Notification.permission === 'granted')
    })()
    return () => { live = false }
  }, [support])

  const enable = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const key = await getPushPublicKey()
      if (!key) { setMessage('Notifications aren’t available on this server yet.'); return }
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        setMessage(result === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or system settings, then try again.' : 'Notifications weren’t turned on.')
        return
      }
      const reg = await registration()
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
      await savePushSubscription(toTarget(sub))
      setSubscribed(true)
      setMessage('Notifications are on for this device.')
    } catch (err) {
      setMessage(err instanceof Error && err.message ? `Couldn’t turn on notifications: ${err.message}` : 'Couldn’t turn on notifications.')
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      await disablePush()
      setSubscribed(false)
      setMessage('Notifications are off for this device.')
    } finally {
      setBusy(false)
    }
  }, [])

  const test = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const { sent } = await sendTestPush()
      setMessage(sent ? `Sent to ${sent} device${sent === 1 ? '' : 's'}. It should arrive in a few seconds.` : 'No devices could be reached. Turn notifications off and on again.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Couldn’t send a test.')
    } finally {
      setBusy(false)
    }
  }, [])

  return { support, permission, subscribed, busy, message, enable, disable, test }
}
