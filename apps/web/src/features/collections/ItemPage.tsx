import { useEffect, useRef, type ReactNode } from 'react'
import './collections.css'

/**
 * One full page for creating or editing an item (redesign Phase 4): a way back to its
 * list, the title, then the form. Replaces slide-outs for substantive create/edit, so the
 * page has room, a URL, and browser Back closes it.
 */
export function ItemPage({ back, title, children }: { back: { label: string; onClick: () => void }; title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  // Arriving on the page moves focus to its title (screen readers hear where they are).
  useEffect(() => { heading.current?.focus() }, [])
  return (
    <section className="item-page" aria-labelledby="item-page-title">
      <nav className="item-page-back">
        <button type="button" onClick={back.onClick}>← {back.label}</button>
      </nav>
      <h1 id="item-page-title" ref={heading} tabIndex={-1}>{title}</h1>
      <div className="item-page-body">{children}</div>
    </section>
  )
}
