import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { keys, type ImportProposal } from '@project/sdk'
import { RecordFormDialog } from './RecordChrome'
import {
  importAdapter,
  importError,
  PROPOSAL_LABEL,
  type ImportBatch,
  type ImportRow,
} from './importAdapter'
import type { RecordKind } from './navigation'

type Step = 'upload' | 'map' | 'review' | 'results'

export function RecordImportFlow({
  kind,
  workspaceId,
  onClose,
}: {
  kind: RecordKind
  workspaceId: string
  onClose: () => void
}) {
  const adapter = importAdapter(kind)
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('import.csv')
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const batchRef = useRef(batch)
  batchRef.current = batch
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [onMatch, setOnMatch] = useState<'skip' | 'update'>('skip')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [filter, setFilter] = useState<ImportProposal | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = kind === 'inventory' ? { onMatch } : undefined

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(importError(err))
    } finally {
      setBusy(false)
    }
  }

  const loadRows = async (imp: ImportBatch, proposal?: ImportProposal | '') => {
    setRows((await adapter.rows(workspaceId, imp.id, proposal || undefined)).data)
  }

  useEffect(() => {
    return () => {
      const current = batchRef.current
      if (current?.status === 'previewed') void adapter.cancel(workspaceId, current.id).catch(() => undefined)
    }
  }, [adapter, workspaceId])

  const sampleByColumn = (() => {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length < 2 || !batch) return {} as Record<string, string>
    const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
    const values = lines[1]!.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const out: Record<string, string> = {}
    for (const [index, column] of (batch.columns as { id: string; label: string }[]).entries()) {
      const headerIndex = headers.findIndex((h) => h === column.label)
      out[column.id] = values[headerIndex >= 0 ? headerIndex : index] ?? ''
    }
    return out
  })()

  const counts = batch?.counts
  const unresolved = counts?.unresolved ?? 0
  const matchSelect = (
    <label>
      <span>{adapter.optionsLabel}</span>
      <select aria-label="Match behaviour" value={onMatch} onChange={(e) => setOnMatch(e.target.value as 'skip' | 'update')}>
        <option value="skip">Skip matched SKUs</option>
        <option value="update">Update matched SKUs</option>
      </select>
    </label>
  )

  return (
    <RecordFormDialog title={adapter.title} onClose={onClose}>
      <div className="record-import">
        <nav className="record-import-steps" aria-label="Import steps">
          {(['upload', 'map', 'review', 'results'] as const).map((value) => (
            <span key={value} data-current={step === value || undefined}>
              {value === 'upload' ? 'Upload' : value === 'map' ? 'Map' : value === 'review' ? 'Review' : 'Results'}
            </span>
          ))}
        </nav>
        {error && (
          <p role="alert" className="record-error">
            {error}
          </p>
        )}
        {step === 'upload' && (
          <div className="record-import-panel">
            <p>Paste a CSV or choose a file. Headers become mappable columns.</p>
            <label className="record-file">
              <span>CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setFilename(file.name || 'import.csv')
                  const reader = new FileReader()
                  reader.onload = () => setCsv(String(reader.result ?? ''))
                  reader.readAsText(file)
                }}
              />
            </label>
            <label>
              <span>Or paste CSV</span>
              <textarea
                aria-label="CSV text"
                rows={10}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                placeholder={'Name,Email\nAda Lovelace,ada@example.com'}
              />
            </label>
            {kind === 'inventory' && matchSelect}
            <footer>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="record-primary"
                disabled={busy || !csv.trim()}
                onClick={() =>
                  void run(async () => {
                    const imp = await adapter.preview(workspaceId, csv, filename, undefined, options)
                    setBatch(imp)
                    setMapping({ ...(imp.mapping as Record<string, string>) })
                    setStep('map')
                  })
                }
              >
                {busy ? 'Reading…' : 'Continue'}
              </button>
            </footer>
          </div>
        )}
        {step === 'map' && batch && (
          <div className="record-import-panel">
            <p>
              {batch.totalRows} rows from {batch.source.filename ?? 'CSV'}.
              {batch.previousImportId ? ' This table was imported before.' : ''}
            </p>
            {kind === 'inventory' && matchSelect}
            <table className="record-import-map">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Sample</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {(batch.columns as { id: string; label: string }[]).map((column) => (
                  <tr key={column.id}>
                    <td>{column.label}</td>
                    <td className="record-muted">{sampleByColumn[column.id] || '—'}</td>
                    <td>
                      <select
                        aria-label={`Map ${column.label}`}
                        value={mapping[column.id] ?? ''}
                        onChange={(e) => {
                          const next = { ...mapping }
                          if (e.target.value) next[column.id] = e.target.value
                          else delete next[column.id]
                          setMapping(next)
                        }}
                      >
                        <option value="">Ignore</option>
                        {adapter.fields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer>
              <button type="button" disabled={busy} onClick={() => setStep('upload')}>
                Back
              </button>
              <button
                className="record-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const imp = await adapter.remap(workspaceId, batch.id, mapping, options)
                    setBatch(imp)
                    await loadRows(imp)
                    setFilter('')
                    setStep('review')
                  })
                }
              >
                {busy ? 'Previewing…' : 'Preview rows'}
              </button>
            </footer>
          </div>
        )}
        {step === 'review' && batch && counts && (
          <div className="record-import-panel">
            <p className="record-import-counts" role="status">
              {counts.create} create · {counts.match} match · {counts.review} review · {counts.duplicate} duplicate ·{' '}
              {counts.invalid} invalid
              {unresolved ? ` · ${unresolved} need a decision` : ''}
            </p>
            <div className="record-import-filters">
              <button
                aria-pressed={!filter}
                onClick={() =>
                  void run(async () => {
                    setFilter('')
                    await loadRows(batch)
                  })
                }
              >
                All
              </button>
              {(['create', 'match', 'review', 'duplicate', 'invalid'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() =>
                    void run(async () => {
                      setFilter(value)
                      await loadRows(batch, value)
                    })
                  }
                >
                  {PROPOSAL_LABEL[value]}
                </button>
              ))}
            </div>
            <ul className="record-import-rows">
              {rows.map((row) => (
                <li key={row.id}>
                  <strong>
                    Row {row.rowNumber} · {PROPOSAL_LABEL[row.proposal]}
                  </strong>
                  <span className="record-muted">
                    {Object.entries(row.values ?? {})
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ') ||
                      row.errorCode ||
                      '—'}
                  </span>
                  {row.proposal === 'match' && <span>→ {adapter.matchLabel(row)}</span>}
                  {row.proposal === 'review' && (
                    <div className="record-import-resolve">
                      {(['create', 'use', 'skip'] as const).map((action) =>
                        action === 'use' && !adapter.matchId(row) ? null : (
                          <button
                            key={action}
                            disabled={busy || !!row.resolution || (action === 'use' && !adapter.matchId(row))}
                            onClick={() =>
                              void run(async () => {
                                const next = await adapter.resolve(
                                  workspaceId,
                                  batch.id,
                                  row.id,
                                  action,
                                  action === 'use' ? adapter.matchId(row) ?? undefined : undefined,
                                )
                                setBatch(next)
                                await loadRows(next, filter)
                              })
                            }
                          >
                            {action === 'create' ? 'Create new' : action === 'use' ? 'Use match' : 'Skip'}
                          </button>
                        ),
                      )}
                      {row.resolution && <span role="status">Decided: {row.resolution}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <footer>
              <button type="button" disabled={busy} onClick={() => setStep('map')}>
                Back
              </button>
              <button
                className="record-primary"
                disabled={busy || unresolved > 0}
                onClick={() =>
                  void run(async () => {
                    const imp = await adapter.commit(workspaceId, batch.id)
                    setBatch(imp)
                    await loadRows(imp)
                    setStep('results')
                    void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
                  })
                }
              >
                {busy ? 'Importing…' : unresolved > 0 ? `Resolve ${unresolved} rows` : `Import ${adapter.noun}s`}
              </button>
            </footer>
          </div>
        )}
        {step === 'results' && batch && counts && (
          <div className="record-import-panel">
            <p role="status">
              Imported {counts.created} · matched {counts.matched} · skipped {counts.skipped}
            </p>
            <ul className="record-import-rows">
              {rows
                .filter((row) => row.outcome)
                .slice(0, 40)
                .map((row) => (
                  <li key={row.id}>
                    <strong>
                      Row {row.rowNumber} · {row.outcome}
                    </strong>
                    <span className="record-muted">{row.outcomeNote || adapter.matchLabel(row)}</span>
                  </li>
                ))}
            </ul>
            <footer>
              <button className="record-primary" onClick={onClose}>
                Done
              </button>
            </footer>
          </div>
        )}
      </div>
    </RecordFormDialog>
  )
}
