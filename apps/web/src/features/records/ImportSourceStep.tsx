import { useState } from 'react'
import {
  CONNECTED_PREVIEWS,
  IMPORT_SOURCES,
  SOURCE_CATEGORY_LABEL,
  type ConnectField,
  type ImportSource,
  type SourceId,
} from './importSources'
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
        kind={kind}
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
      <section className="record-import-section" aria-labelledby="import-connected">
        <h3 id="import-connected">Connected</h3>
        <p className="record-muted">Reuse a system this workspace already knows.</p>
        <ul className="record-import-source-list">
          {CONNECTED_PREVIEWS.map((card) => (
            <li key={card.id}>
              <button type="button" className="record-import-source" disabled title="Preview layout">
                <span className="record-import-source-name">{card.label}</span>
                <span className="record-muted">{card.detail}</span>
                <span className="record-muted">{card.lastSynced}</span>
                <span className="record-import-source-action">{card.action}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="record-muted record-import-note">Preview cards — live connections arrive with Airtable / WooCommerce.</p>
      </section>

      <section className="record-import-section" aria-labelledby="import-new">
        <h3 id="import-new">Connect a new source</h3>
        <p className="record-muted">
          {kind === 'contacts'
            ? 'Get contacts into this workspace.'
            : 'Get catalog rows into this workspace.'}
        </p>
        {(Object.keys(SOURCE_CATEGORY_LABEL) as ImportSource['category'][]).map((category) => {
          const group = sources.filter((s) => s.category === category)
          if (!group.length) return null
          return (
            <div key={category} className="record-import-category">
              <h4>{SOURCE_CATEGORY_LABEL[category]}</h4>
              <ul className="record-import-source-list">
                {group.map((source) => (
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
                      <span className="record-import-source-name">
                        {source.name}
                        {source.status === 'preview' && (
                          <span className="record-import-badge">Soon</span>
                        )}
                      </span>
                      <span className="record-muted">{source.blurb}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function ConnectPanel({
  source,
  kind,
  draft,
  mode,
  onDraft,
  onMode,
  onBack,
}: {
  source: ImportSource
  kind: RecordKind
  draft: Record<string, string>
  mode: SyncMode
  onDraft: (id: string, value: string) => void
  onMode: (mode: SyncMode) => void
  onBack: () => void
}) {
  return (
    <div className="record-import-panel">
      <button type="button" className="record-import-back" onClick={onBack}>
        ← All sources
      </button>
      <h3>{source.name}</h3>
      <p className="record-muted">{source.blurb}</p>

      {source.syncable && (
        <fieldset className="record-import-mode">
          <legend>How should this run?</legend>
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
            <span>Keep synced · one-way into this workspace</span>
          </label>
        </fieldset>
      )}

      <div className="record-form-group">
        <h3>Connection</h3>
        {source.fields.map((field) => (
          <Field key={field.id} field={field} value={draft[field.id] ?? ''} onChange={onDraft} />
        ))}
      </div>

      <p className="record-muted record-import-note" role="status">
        UI preview only. {source.name} will feed {kind === 'contacts' ? 'Contacts' : 'Inventory'} through
        the shared map → match → review pipeline once wired.
      </p>
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
        <span>{field.label}</span>
        {field.hint && <p className="record-muted">{field.hint}</p>}
        <button type="button" disabled>
          Connect {field.label}
        </button>
      </div>
    )
  }
  return (
    <label>
      <span>
        {field.label}
        {field.required ? '' : ' (optional)'}
      </span>
      <input
        type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
        value={value}
        placeholder={field.hint}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(field.id, e.target.value)}
      />
    </label>
  )
}
