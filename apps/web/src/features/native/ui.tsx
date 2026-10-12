// The /native/ app's primitives. Every tab is built from these, so spacing, type and
// touch targets stay the same everywhere: Screen (title bar), Section, Row, Glyph,
// Banner, Button, Switch, Segmented, Empty, Skeleton, Snackbar.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronIcon } from './icons'

// ─── Screen ──────────────────────────────────────────────────────────────────

/** A tab's page: a large title that becomes a compact bar once the page scrolls. */
export function Screen({ title, actions, children, label }: { title: ReactNode; actions?: ReactNode; children: ReactNode; label?: string }) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry!.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <section className="n-screen" aria-label={label}>
      <header className="n-bar" data-scrolled={scrolled || undefined}>
        <h1 className="n-bar-title">{title}</h1>
        {actions && <div className="n-bar-actions">{actions}</div>}
      </header>
      <div ref={sentinel} className="n-sentinel" aria-hidden />
      <div className="n-screen-body">{children}</div>
    </section>
  )
}

// ─── lists ───────────────────────────────────────────────────────────────────

export function Section({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="n-section">
      {title && <h2 className="n-section-title">{title}</h2>}
      <ul className="n-rows">{children}</ul>
      {footer && <p className="n-section-footer">{footer}</p>}
    </section>
  )
}

type RowProps = {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  /** Top-right, beside the title (a time). */
  aside?: ReactNode
  trailing?: ReactNode
  /** Something new: a small dot at the leading edge and a stronger title. */
  unread?: boolean
  busy?: boolean
  danger?: boolean
  chevron?: boolean
  onClick?: () => void
  to?: string
  href?: string
  label?: string
}

/** One line of a list. Clickable rows are a single target (button or link). */
export function Row({ leading, title, subtitle, meta, aside, trailing, unread, busy, danger, chevron, onClick, to, href, label }: RowProps) {
  const body = (
    <>
      {leading && <span className="n-row-leading">{leading}</span>}
      <span className="n-row-main">
        <span className="n-row-top">
          <span className="n-row-title">{title}</span>
          {aside && <span className="n-row-aside">{aside}</span>}
        </span>
        {subtitle && <span className="n-row-subtitle">{subtitle}</span>}
        {meta && <span className="n-row-meta">{meta}</span>}
      </span>
      {(trailing || chevron) && (
        <span className="n-row-trailing">
          {trailing}
          {chevron && <ChevronIcon className="n-chevron" />}
        </span>
      )}
    </>
  )
  const attrs = { className: 'n-row', 'data-unread': unread || undefined, 'data-danger': danger || undefined, 'aria-busy': busy || undefined, 'aria-label': label }
  return (
    <li>
      {to ? <Link {...attrs} to={to}>{body}</Link>
        : href ? <a {...attrs} href={href}>{body}</a>
          : onClick ? <button type="button" {...attrs} onClick={onClick}>{body}</button>
            : <div {...attrs}>{body}</div>}
    </li>
  )
}

/** A leading tile: an icon, or a letter for a workspace. `tone` colors it for things that need you. */
export function Glyph({ children, tone = 'quiet', size = 'md' }: { children: ReactNode; tone?: 'quiet' | 'accent' | 'warn'; size?: 'md' | 'lg' }) {
  return <span className="n-glyph" data-tone={tone} data-size={size} aria-hidden>{children}</span>
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  return (
    <span className="n-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden>
      {src ? <img src={src} alt="" /> : name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}

export function Badge({ count, more }: { count: number; more?: boolean }) {
  if (!count) return null
  return <span className="n-badge" aria-label={`${count}${more ? '+' : ''} unread`}>{count > 99 ? '99+' : `${count}${more ? '+' : ''}`}</span>
}

// ─── controls ────────────────────────────────────────────────────────────────

export function Button({ children, variant = 'tonal', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'filled' | 'tonal' | 'text' }) {
  return <button type="button" className="n-button" data-variant={variant} {...props}>{children}</button>
}

export function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className="n-icon-button" aria-label={label} title={label} {...props}>{children}</button>
}

export function Switch({ checked, label, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role'> & { checked: boolean; label: string }) {
  return <button type="button" className="n-switch" role="switch" aria-checked={checked} aria-label={label} {...props}><span aria-hidden /></button>
}

/** Two or three views of the same list. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; count?: number }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div className="n-segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
          {!!o.count && <span className="n-segmented-count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A filter that is on, with a way off. */
export function Chip({ children, onClear, clearLabel }: { children: ReactNode; onClear: () => void; clearLabel: string }) {
  return (
    <span className="n-chip">
      {children}
      <button type="button" aria-label={clearLabel} onClick={onClear}>×</button>
    </span>
  )
}

// ─── surfaces ────────────────────────────────────────────────────────────────

/** A calm, dismissible message above a list. */
export function Banner({ icon, title, children, actions, onDismiss, tone = 'plain' }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode; onDismiss?: () => void; tone?: 'plain' | 'accent' }) {
  return (
    <aside className="n-banner" data-tone={tone}>
      {icon && <span className="n-banner-icon" aria-hidden>{icon}</span>}
      <div className="n-banner-body">
        <strong>{title}</strong>
        {children && <div className="n-banner-text">{children}</div>}
        {actions && <div className="n-banner-actions">{actions}</div>}
      </div>
      {onDismiss && <button type="button" className="n-banner-close" aria-label="Dismiss" onClick={onDismiss}>×</button>}
    </aside>
  )
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="n-empty">
      {icon && <span className="n-empty-icon" aria-hidden>{icon}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="n-rows n-skeleton" aria-busy aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}><div className="n-row"><span className="n-row-leading"><span className="n-glyph" /></span><span className="n-row-main"><span className="n-sk n-sk-title" /><span className="n-sk n-sk-line" /></span></div></li>
      ))}
    </ul>
  )
}

// ─── snackbar ────────────────────────────────────────────────────────────────

const SnackbarContext = createContext<(text: string) => void>(() => {})

/** One short message at a time, above the tab bar. */
export function SnackbarHost({ children }: { children: ReactNode }) {
  const [text, setText] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const say = useCallback((next: string) => {
    window.clearTimeout(timer.current)
    setText(next)
    timer.current = window.setTimeout(() => setText(''), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <SnackbarContext.Provider value={say}>
      {children}
      <div className="n-snackbar" role="status" aria-live="polite" data-open={text ? true : undefined}>{text}</div>
    </SnackbarContext.Provider>
  )
}

export const useSnackbar = () => useContext(SnackbarContext)
