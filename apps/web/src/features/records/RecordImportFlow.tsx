import { useEffect, useState } from 'react'
import { CsvExample } from '../../components/CsvExample'
import { useQueryClient } from '@tanstack/react-query'
import { keys, type ImportProposal } from '@project/sdk'
import { importAdapter, importError, importReason, PROPOSAL_LABEL, type ImportBatch, type ImportRow } from './importAdapter'
import { RecordFormDialog } from './RecordChrome'
import { ItemPage } from '../collections/ItemPage'
import type { ReactNode } from 'react'
import type { RecordKind } from './navigation'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
import { contactsToCsv, inventoryToCsv } from '../prefab/csvFormatters'
import type { PrefabContact, PrefabInventory } from '@project/shared'
import { ImportModalTabs } from '../prefab/ImportModalChrome'

type Step = 'source' | 'upload' | 'map' | 'review' | 'results'

const CSV_STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: '1. Upload' },
  { id: 'map', label: '2. Map' },
  { id: 'review', label: '3. Review' },
  { id: 'results', label: '4. Results' },
]

export function RecordImportFlow({
  kind,
  workspaceId,
  onClose,
  page,
}: {
  kind: RecordKind
  workspaceId: string
  onClose: () => void
  /** Full page (Phase 4) instead of a dialog; `backLabel` names the list. */
  page?: { backLabel: string }
}) {
  const adapter = importAdapter(kind)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'starter-packs' | 'csv'>('starter-packs')
  const [step, setStep] = useState<Step>('source')
  const [isStarterBatch, setIsStarterBatch] = useState(false)
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('import.csv')
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [onMatch, setOnMatch] = useState<'skip' | 'update'>('skip')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [filter, setFilter] = useState<ImportProposal | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resumeKey = `records.import:${workspaceId}:${kind}`
  const remember = (imp: ImportBatch) => {
    try {
      sessionStorage.setItem(resumeKey, imp.id)
    } catch {
      /* Optional session recovery. */
    }
    setBatch(imp)
  }
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
    let active = true
    let id: string | null = null
    try {
      id = sessionStorage.getItem(resumeKey)
    } catch {
      /* Storage unavailable. */
    }
    if (id) {
      setBusy(true)
      void adapter
        .get(workspaceId, id)
        .then(async (imp) => {
          if (!active) return
          if (imp.status === 'cancelled') {
            try {
              sessionStorage.removeItem(resumeKey)
            } catch {
              /* Optional storage. */
            }
            return
          }
          const loaded = await adapter.rows(workspaceId, imp.id)
          if (!active) return
          setActiveTab('csv')
          setBatch(imp)
          setMapping({ ...(imp.mapping as Record<string, string>) })
          if ('onMatch' in imp.options) setOnMatch(imp.options.onMatch === 'update' ? 'update' : 'skip')
          setRows(loaded.data)
          setStep(imp.status === 'completed' ? 'results' : 'review')
        })
        .catch((err) => {
          if (active) setError(importError(err))
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }
    return () => {
      active = false
    }
  }, [adapter, workspaceId, resumeKey])

  const close = () => {
    if (busy) return
    if (batch?.status === 'committing') {
      onClose()
      return
    }
    void run(async () => {
      if (batch?.status === 'previewed') await adapter.cancel(workspaceId, batch.id)
      try {
        sessionStorage.removeItem(resumeKey)
      } catch {
        /* Optional storage. */
      }
      onClose()
    })
  }

  const selectTab = (tabId: 'starter-packs' | 'csv') => {
    setActiveTab(tabId)
    setError('')
    if (tabId === 'csv' && step === 'source') {
      setStep('upload')
    } else if (tabId === 'starter-packs' && step === 'upload') {
      setStep('source')
    }
  }

  const handleImportStarterPack = (records: any[], packName: string) => {
    void run(async () => {
      const generatedCsv =
        kind === 'contacts'
          ? contactsToCsv(records as PrefabContact[])
          : inventoryToCsv(records as PrefabInventory[])
      setFilename(`${packName}.csv`)
      setCsv(generatedCsv)
      const imp = await adapter.preview(workspaceId, generatedCsv, `${packName}.csv`, undefined, options)
      remember(imp)
      setMapping({ ...(imp.mapping as Record<string, string>) })
      await loadRows(imp)
      setIsStarterBatch(true)
      setStep('review')
    })
  }

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
      <select
        aria-label="Match behaviour"
        value={onMatch}
        onChange={(e) => setOnMatch(e.target.value as 'skip' | 'update')}
      >
        <option value="skip">Skip matched SKUs</option>
        <option value="update">Update matched SKUs</option>
      </select>
    </label>
  )

  return (
    <Frame
      page={page}
      title={adapter.title}
      onClose={close}
    >
      <div className="record-form record-import">
        <ImportModalTabs
          tabs={[
            { id: 'starter-packs', label: 'Starter Packs' },
            { id: 'csv', label: 'CSV Upload', ariaLabel: 'CSV' },
          ]}
          activeTab={activeTab}
          onSelectTab={(id) => selectTab(id as 'starter-packs' | 'csv')}
        />
        {activeTab === 'csv' && (
          <nav className="record-import-steps" aria-label="CSV import steps">
            {CSV_STEPS.map((entry) => (
              <span key={entry.id} data-current={step === entry.id || undefined}>
                {entry.label}
              </span>
            ))}
          </nav>
        )}
        <div className="record-form-fields">
          {error && (
            <p role="alert" className="record-error">
              {error}
            </p>
          )}
          {activeTab === 'starter-packs' && (step === 'source' || !isStarterBatch) && (
            <div className="record-import-panel">
              <StarterPackPicker
                domain={kind}
                confirmLabel="Load into preview"
                onImport={handleImportStarterPack}
                onCancel={close}
              />
            </div>
          )}
          {activeTab === 'csv' && step === 'upload' && (
            <div className="record-import-panel">
              <label className="record-file">
                <span>CSV file</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="CSV file"
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
              <CsvExample
                example={kind === 'contacts'
                  ? 'firstName,lastName,email,phone\nDana,Lee,dana@example.com,512-555-0100'
                  : 'name,sku,price,quantity\nPool filter,PF-100,49.99,12'}
                note={kind === 'contacts'
                  ? 'Include a name, email, or phone. You can map your column headers in the next step.'
                  : 'Include a name. Price and quantity are numbers; you can map your column headers in the next step.'}
              />
              {csv.trim() && (
                <p className="record-muted" role="status">
                  {filename}
                </p>
              )}
              {kind === 'inventory' && matchSelect}
            </div>
          )}
          {((activeTab === 'csv' && step === 'map') || (activeTab === 'starter-packs' && step === 'map')) && batch && (
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
            </div>
          )}
          {step === 'review' && batch && counts && (
            <div className="record-import-panel">
              <p className="record-import-counts" role="status">
                {counts.create} create · {counts.match} match · {counts.review} review · {counts.duplicate}{' '}
                duplicate · {counts.invalid} invalid
                {unresolved ? ` · ${unresolved} need a decision` : ''}
              </p>
              <p className="record-muted">
                {kind === 'contacts'
                  ? 'Matched contacts remain unchanged.'
                  : onMatch === 'update'
                    ? 'Matched SKUs update mapped non-empty fields. Blank cells keep existing values; quantity 0 means out of stock. Items changed since this import was opened are skipped.'
                    : 'Matched SKUs remain unchanged.'}
              </p>
              {batch.status === 'committing' && (
                <p role="status">
                  {(counts.created ?? 0) + (counts.matched ?? 0) + (counts.skipped ?? 0)} of {batch.totalRows}{' '}
                  rows processed. Retry continues this import without repeating completed rows.
                </p>
              )}
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
                    {row.errorCode && <span>{importReason(row.errorCode)}</span>}
                    {row.proposal === 'match' && <span>→ {adapter.matchLabel(row)}</span>}
                    {row.proposal === 'review' && (
                      <div className="record-import-resolve">
                        {[
                          { action: 'create' as const, id: '', label: 'Create new' },
                          ...adapter.candidates(row).map((candidate) => ({
                            action: 'use' as const,
                            id: candidate.id,
                            label: `Use ${candidate.label}`,
                          })),
                          { action: 'skip' as const, id: '', label: 'Skip' },
                        ].map((choice) => (
                          <button
                            key={`${choice.action}:${choice.id}`}
                            disabled={busy || !!row.resolution || batch.status !== 'previewed'}
                            onClick={() =>
                              void run(async () => {
                                const next = await adapter.resolve(
                                  workspaceId,
                                  batch.id,
                                  row.id,
                                  choice.action,
                                  choice.id || undefined,
                                )
                                remember(next)
                                await loadRows(next, filter)
                              })
                            }
                          >
                            {choice.label}
                          </button>
                        ))}
                        {row.resolution && <span role="status">Decided: {row.resolution}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {step === 'results' && batch && counts && (
            <div className="record-import-panel">
              <p role="status">
                Created {counts.created} · existing records matched {counts.matched} · skipped {counts.skipped}
              </p>
              <ul className="record-import-rows">
                {rows
                  .filter((row) => row.outcome)
                  .slice(0, 40)
                  .map((row) => (
                    <li key={row.id}>
                      <strong>
                        Row {row.rowNumber} ·{' '}
                        {row.outcomeNote === 'UPDATED'
                          ? 'updated'
                          : row.outcome === 'matched'
                            ? 'matched — unchanged'
                            : row.outcome}
                      </strong>
                      <span className="record-muted">
                        {row.outcomeNote ? importReason(row.outcomeNote) : adapter.matchLabel(row)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
        <footer>
          {step === 'source' && (
            <button type="button" onClick={close}>
              Cancel
            </button>
          )}
          {step === 'upload' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setCsv('')
                  setFilename('import.csv')
                  setActiveTab('starter-packs')
                  setStep('source')
                }}
              >
                Back
              </button>
              <button
                className="record-primary"
                disabled={busy || !csv.trim()}
                onClick={() =>
                  void run(async () => {
                    const imp = await adapter.preview(workspaceId, csv, filename, undefined, options)
                    remember(imp)
                    setMapping({ ...(imp.mapping as Record<string, string>) })
                    setStep('map')
                  })
                }
              >
                {busy ? 'Reading…' : 'Continue'}
              </button>
            </>
          )}
          {step === 'map' && batch && (
            <>
              <button type="button" disabled={busy} onClick={() => setStep('upload')}>
                Back
              </button>
              <button
                className="record-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const imp = await adapter.remap(workspaceId, batch.id, mapping, options)
                    remember(imp)
                    await loadRows(imp)
                    setFilter('')
                    setStep('review')
                  })
                }
              >
                {busy ? 'Previewing…' : 'Preview rows'}
              </button>
            </>
          )}
          {step === 'review' && batch && counts && (
            <>
              <button
                type="button"
                disabled={busy || batch.status !== 'previewed'}
                onClick={() => {
                  if (isStarterBatch) {
                    setIsStarterBatch(false)
                    setStep('source')
                    setActiveTab('starter-packs')
                  } else {
                    setStep('map')
                  }
                }}
              >
                Back
              </button>
              <button
                className="record-primary"
                disabled={busy || unresolved > 0}
                onClick={() =>
                  void run(async () => {
                    remember({ ...batch, status: 'committing' })
                    let imp: ImportBatch
                    try {
                      imp = await adapter.commit(workspaceId, batch.id)
                    } catch (err) {
                      try {
                        const current = await adapter.get(workspaceId, batch.id)
                        remember(current)
                        await loadRows(current)
                        if (current.status === 'completed') setStep('results')
                      } catch {
                        /* Retain the job id for retry when the connection returns. */
                      }
                      void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
                      throw err
                    }
                    remember(imp)
                    await loadRows(imp)
                    setStep('results')
                    void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
                  })
                }
              >
                {busy
                  ? 'Importing…'
                  : batch.status === 'committing'
                    ? 'Retry remaining rows'
                    : unresolved > 0
                      ? `Resolve ${unresolved} rows`
                      : `Import ${adapter.noun}s`}
              </button>
            </>
          )}
          {step === 'results' && (
            <button className="record-primary" onClick={close}>
              Done
            </button>
          )}
        </footer>
      </div>
    </Frame>
  )
}

// Defined at module level (a component made inside render would remount the flow).
function Frame({
  page,
  title,
  subtitle,
  onClose,
  children,
}: {
  page?: { backLabel: string }
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return page ? (
    <ItemPage back={{ label: page.backLabel, onClick: onClose }} title={title}>
      {children}
    </ItemPage>
  ) : (
    <RecordFormDialog title={title} subtitle={subtitle} width="640px" onClose={onClose}>
      {children}
    </RecordFormDialog>
  )
}

