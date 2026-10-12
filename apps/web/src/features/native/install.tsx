// Installing the /native/ app: platform detection, the Android/desktop install
// prompt (captured early in index.html), and iOS Add to Home Screen steps.
// Shared by the app and the homepage feature; nothing here is forced on anyone.
import { useEffect, useState } from 'react'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global {
  interface Window { __installPrompt?: InstallPrompt }
  interface Navigator { standalone?: boolean }
}

export type Platform = 'ios' | 'android' | 'desktop'

/** Set once the app has run installed in this browser profile (best effort: iOS keeps home-screen storage apart). */
const INSTALLED_KEY = '8080.app-installed'

export function platform(): Platform {
  const ua = navigator.userAgent
  // iPadOS reports a Mac user agent; touch gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
}

export function rememberInstalled() {
  try { localStorage.setItem(INSTALLED_KEY, '1') } catch { /* storage unavailable */ }
}

export function knownInstalled() {
  try { return localStorage.getItem(INSTALLED_KEY) === '1' } catch { return false }
}

/** iOS shows Add to Home Screen only in Safari (other iOS browsers vary by version). */
export function iosSafari() {
  const ua = navigator.userAgent
  return platform() === 'ios' && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)
}

/** The browser's own install prompt, when it offers one (Chromium: Android and desktop). */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(() => window.__installPrompt ?? null)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const ready = () => setPrompt(window.__installPrompt ?? null)
    const done = () => {
      window.__installPrompt = undefined
      setPrompt(null)
      setInstalled(true)
      rememberInstalled()
    }
    window.addEventListener('installpromptready', ready)
    window.addEventListener('appinstalled', done)
    return () => {
      window.removeEventListener('installpromptready', ready)
      window.removeEventListener('appinstalled', done)
    }
  }, [])
  const install = async () => {
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    // A prompt can be used once.
    window.__installPrompt = undefined
    setPrompt(null)
    return outcome === 'accepted'
  }
  return { canPrompt: !!prompt, install, installed }
}

export function IosSteps() {
  if (!iosSafari()) return <p>Open this page in Safari, then tap Share and choose Add to Home Screen.</p>
  return (
    <ol className="install-steps">
      <li>Tap <strong>Share</strong> <ShareGlyph /> in Safari’s toolbar.</li>
      <li>Choose <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong>. 8080 opens from your home screen like an app.</li>
    </ol>
  )
}

function ShareGlyph() {
  return (
    <svg className="install-share" viewBox="0 0 16 20" width="12" height="15" aria-label="(the square with an arrow)" role="img">
      <path d="M8 1v11M4.5 4.5 8 1l3.5 3.5M5 8H2v11h12V8h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
