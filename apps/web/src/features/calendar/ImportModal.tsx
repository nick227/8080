import { useEffect, useRef, useState } from 'react'
import { dayTitle } from './dates'
import { parseTaskCsv, parseTaskList, type ImportedTask } from './importParse'

export function ImportModal({ mode, day, onClose, onImport }: {
  mode: 'list' | 'csv'
  day: string
  onClose: () => void
  onImport: (tasks: ImportedTask[]) => number
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const list = mode === 'list'

  useEffect(() => { areaRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const node = dialogRef.current
      if (!node) return
      const items = [...node.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const readFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((value) => {
      setText(value)
      setError('')
      areaRef.current?.focus()
    })
  }

  const submit = () => {
    const parsed = list ? parseTaskList(text, day) : parseTaskCsv(text)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    if (onImport(parsed.tasks) === 0) {
      setError('Those tasks are already on the calendar.')
      return
    }
    onClose()
  }

  return (
    <div className="cal-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-import-title">
        <h2 id="cal-import-title">Import</h2>
        <form onSubmit={(event) => { event.preventDefault(); submit() }}>
          <label className="cal-field">
            <span>{list ? 'Tasks' : 'CSV'}</span>
            <textarea
              ref={areaRef}
              value={text}
              rows={8}
              spellCheck={false}
              placeholder={list ? 'Call Dana, Send the note' : 'title,date,time\nCall Dana,2026-10-08,9:00 AM'}
              onChange={(event) => { setText(event.target.value); setError('') }}
            />
          </label>
          <p className="cal-noon">
            {list
              ? `Commas or new lines. Each task is added at 12:00 PM on ${dayTitle(day)}.`
              : 'Needs title and date columns. time and status are optional. Every row must be valid.'}
          </p>
          {error && <p className="cal-error" role="alert">{error}</p>}
          <div className="cal-actions">
            <button type="button" className="cal-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="cal-btn" onClick={() => fileRef.current?.click()}>Choose file</button>
            <button type="submit" className="cal-btn" data-primary="" disabled={!text.trim()}>Import</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(event) => {
              const files = event.target.files
              readFile(files && files.length > 0 ? files[0] : undefined)
              event.target.value = ''
            }}
          />
        </form>
      </div>
    </div>
  )
}
