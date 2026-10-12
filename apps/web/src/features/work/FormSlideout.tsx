import { useEffect, useRef, type ReactNode } from 'react'
import './FormSlideout.css'

/** Shared creation/edit slideout for every work desk. */
export function FormSlideout({
  title,
  subtitle,
  children,
  onClose,
  width,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  onClose: () => void
  width?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialog.current
    node?.showModal()
    node?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus()
    return () => {
      node?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      className="record-form-dialog"
      ref={dialog}
      aria-label={title}
      style={width ? { width: `min(${width}, 100vw)` } : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <div className="form-slideout-subtitle">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close form">
          ✕
        </button>
      </header>
      {children}
    </dialog>
  )
}

