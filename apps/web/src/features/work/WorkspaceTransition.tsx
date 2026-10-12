import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './workspace-transition.css'

/** Animate a change of desk without remounting its state or delaying navigation. */
export function WorkspaceTransition({ view, children }: { view: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = surface.current
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    })
    // Rapid navigation cancels the previous fade; no queue of outgoing views.
    return () => animation.cancel()
  }, [view])
  return <div ref={surface} className="workspace-transition">{children}</div>
}

/** Reserve a quiet content area; fast cached loads never flash an indicator. */
export function WorkspaceLoading({ label = 'Loading workspace…' }: { label?: string }) {
  return (
    <div className="workspace-loading" role="status" aria-label={label}>
      <span className="workspace-loading-indicator" aria-hidden="true">
        <span className="workspace-loading-mark" />
        <span>{label}</span>
      </span>
    </div>
  )
}
