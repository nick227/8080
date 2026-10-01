// One playback contract for every media source (uploaded/captured <audio>/<video>,
// and external YouTube). The reply-at-position flow and anchors only talk to this.

export type PlayOutcome = 'playing' | 'blocked' | 'unplayable'

export interface PlayableMediaController {
  readonly kind: 'html' | 'youtube'
  /** Resolves once playback really started, or why it didn't (blocked = needs a tap). */
  play(): Promise<PlayOutcome>
  pause(): void
  seek(ms: number): void
  getCurrentTimeMs(): number
  /** null until known (metadata not loaded yet / external duration unknown). */
  getDurationMs(): number | null
  onEnded(cb: () => void): () => void
}

// Controllers are attached to the element that renders the media, so callers
// (e.g. REPLY HERE) can find "the media playing inside this item" without caring
// what kind it is.
const registry = new WeakMap<Element, PlayableMediaController>()

export function registerController(el: Element, controller: PlayableMediaController) {
  registry.set(el, controller)
  el.setAttribute('data-media-controller', controller.kind)
  return () => {
    if (registry.get(el) === controller) {
      registry.delete(el)
      el.removeAttribute('data-media-controller')
    }
  }
}

export function controllerWithin(root: Element | null): PlayableMediaController | null {
  const el = root?.querySelector('[data-media-controller]')
  return (el && registry.get(el)) || null
}

export function htmlMediaController(el: HTMLMediaElement): PlayableMediaController {
  return {
    kind: 'html',
    play: () =>
      el.play().then(
        () => 'playing' as const,
        (err: unknown) => (err instanceof DOMException && err.name === 'NotAllowedError' ? 'blocked' : 'unplayable'),
      ),
    pause: () => el.pause(),
    seek: (ms) => { el.currentTime = ms / 1000 },
    getCurrentTimeMs: () => Math.round(el.currentTime * 1000),
    getDurationMs: () => (Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null),
    onEnded: (cb) => {
      el.addEventListener('ended', cb)
      return () => el.removeEventListener('ended', cb)
    },
  }
}
