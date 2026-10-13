import { useEffect, useRef, useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { ImportModalTabs, ApiConnectionsPanel } from '../prefab/ImportModalChrome'
import { CsvExample } from '../../components/CsvExample'
import { parseTaskCsv, parseTaskList, type ImportedTask } from './importParse'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
import { useCurrentWorkspace } from '../../app/workspace'
import type { PrefabTask } from '@project/shared'

type ImportTab = 'csv' | 'api' | 'starter' | 'list'

export function ImportModal({ day, onClose, onImport, workspaceId }: {
  mode?: 'list' | 'csv'
  day: string
  onClose: () => void
  onImport: (tasks: ImportedTask[]) => number
  workspaceId?: string
}) {
  const { workspace } = useCurrentWorkspace()
  const effectiveWsId = workspaceId ?? workspace?.id
  const [tab, setTab] = useState<ImportTab>('csv')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const list = tab === 'list'

  const handleImportPrefabTasks = (records: any[]) => {
    const imported: ImportedTask[] = records.map((r) => {
      const task = r as PrefabTask
      return {
        title: task.title,
        day,
        time: task.repeat !== undefined ? '09:00 AM' : null,
        status: 'open',
      }
    })
    if (onImport(imported) === 0) {
      setError('Those tasks are already on the calendar.')
      return
    }
    onClose()
  }

  useEffect(() => { areaRef.current?.focus() }, [tab])

  const readFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((value) => {
      setText(value)
      setError('')
      areaRef.current?.focus()
    })
  }

  const submit = () => {
    let parsed = list ? parseTaskList(text, day) : parseTaskCsv(text)
    if ('error' in parsed && !list) {
      // Friendly fallback: if not structured CSV, try plain task list
      const listParsed = parseTaskList(text, day)
      if (!('error' in listParsed)) {
        parsed = listParsed
      }
    }
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
    <FormSlideout
      title="Import Tasks"
      width="640px"
      onClose={onClose}
    >
      <ImportModalTabs
        tabs={[
          { id: 'csv', label: 'CSV Upload' },
          { id: 'api', label: 'API Connections' },
          { id: 'starter', label: 'Starter Packs' },
          { id: 'list', label: 'Quick List' },
        ]}
        activeTab={tab}
        onSelectTab={(id) => setTab(id as ImportTab)}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
        {tab === 'api' && (
          <ApiConnectionsPanel
            workspaceId={effectiveWsId}
            domain="tasks"
            onClose={onClose}
          />
        )}

        {tab === 'starter' && (
          <StarterPackPicker
            domain="tasks"
            confirmLabel="Import Tasks"
            onImport={handleImportPrefabTasks}
            onCancel={onClose}
          />
        )}

        {(tab === 'csv' || tab === 'list') && (
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
            {list ? (
              <p className="cal-noon">Commas or new lines. Example: Call Dana, Send the note</p>
            ) : (
              <CsvExample
                example={`title,date,time,status\nCall Dana,${day},9:00 AM,open`}
                note="Required: title, date (YYYY-MM-DD). Optional: time, status (open or done). You can also paste comma-separated task names."
              />
            )}
            {error && <p className="cal-error" role="alert">{error}</p>}
            <div className="cal-actions" style={{ marginTop: '1rem' }}>
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
        )}
      </div>
    </FormSlideout>
  )
}


