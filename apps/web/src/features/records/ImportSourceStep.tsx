import { useState } from 'react'
import { IMPORT_SOURCES, type ConnectField, type ImportSource, type SourceId } from './importSources'
import type { RecordKind } from './navigation'

export type SyncMode = 'once' | 'synced'

type Phase = 'pick' | 'connect'

export function ImportSourceStep({
  kind,
  sourceId,
  mode,
  onPick,
  onMode,
  onBack,
}: {
  kind: RecordKind
  sourceId: SourceId | null
  mode: SyncMode
  onPick: (id: SourceId) => void
  onMode: (mode: SyncMode) => void
  onBack?: () => void
}) {
  const [phase, setPhase] = useState<Phase>(sourceId && sourceId !== 'csv' ? 'connect' : 'pick')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const selected = sourceId ? IMPORT_SOURCES.find((s) => s.id === sourceId) : null
  const sources = IMPORT_SOURCES.filter((s) => s.targets.includes(kind))

  if (phase === 'connect' && selected && selected.id !== 'csv') {
    return (
      <ConnectPanel
        source={selected}
        draft={draft}
        mode={mode}
        onDraft={(id, value) => setDraft((current) => ({ ...current, [id]: value }))}
        onMode={onMode}
        onBack={() => {
          setPhase('pick')
          onBack?.()
        }}
      />
    )
  }

  return (
    <div className="record-import-panel record-import-sources">
      <ul className="record-import-source-list">
        {sources.map((source) => (
          <li key={source.id}>
            <button
              type="button"
              className="record-import-source"
              data-available={source.status === 'available' || undefined}
              onClick={() => {
                onPick(source.id)
                if (source.id === 'csv') return
                setDraft({})
                setPhase('connect')
              }}
            >
              <span className="record-import-source-name">{source.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConnectPanel({
  source,
  draft,
  mode,
  onDraft,
  onMode,
  onBack,
}: {
  source: ImportSource
  draft: Record<string, string>
  mode: SyncMode
  onDraft: (id: string, value: string) => void
  onMode: (mode: SyncMode) => void
  onBack: () => void
}) {
  return (
    <div className="record-import-panel">
      <button type="button" className="record-import-back" onClick={onBack}>
        ← Sources
      </button>
      <h3 className="record-import-connect-title">{source.name}</h3>

      {source.syncable && (
        <fieldset className="record-import-mode">
          <legend>Mode</legend>
          <label className="record-checkbox">
            <input
              type="radio"
              name="sync-mode"
              checked={mode === 'once'}
              onChange={() => onMode('once')}
            />
            <span>Import once</span>
          </label>
          <label className="record-checkbox">
            <input
              type="radio"
              name="sync-mode"
              checked={mode === 'synced'}
              onChange={() => onMode('synced')}
            />
            <span>Keep synced</span>
          </label>
        </fieldset>
      )}

      {source.fields.map((field) => (
        <Field key={field.id} field={field} value={draft[field.id] ?? ''} onChange={onDraft} />
      ))}
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: ConnectField
  value: string
  onChange: (id: string, value: string) => void
}) {
  if (field.type === 'oauth') {
    return (
      <div className="record-import-oauth">
        <button type="button" disabled>
          Sign in with {field.label}
        </button>
      </div>
    )
  }
  return (
    <label>
      <span>
        {field.label}
        {field.optional ? ' · optional' : ''}
      </span>
      <input
        type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
        value={value}
        placeholder={field.placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(field.id, e.target.value)}
      />
    </label>
  )
}
