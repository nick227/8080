import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { ImportModalTabs, ApiConnectionsPanel } from '../prefab/ImportModalChrome'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
import { CsvExample } from '../../components/CsvExample'
import { useAgentTypes, useCreateAgent } from '@project/sdk'
import type { PrefabAutomation } from '@project/shared'
import './agents.css'

const FAMILY_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  followup: 'Follow-ups',
  manual: 'Manual',
  team: 'Team',
  social: 'Social',
}

export function AgentImportSlideout({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<string>('csv')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const types = useAgentTypes(workspaceId)
  const create = useCreateAgent(workspaceId)

  const handleImportAutomations = async (records: any[]) => {
    for (const r of records) {
      const auto = r as PrefabAutomation
      try {
        await create.mutateAsync({ typeKey: auto.typeKey })
      } catch {
        /* already exists or non-fatal */
      }
    }
    onClose()
  }

  const handleCsvSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      setError('Please provide at least one automation row.')
      return
    }
    const hasHeader = lines[0].toLowerCase().includes('type') || lines[0].toLowerCase().includes('name')
    const dataLines = hasHeader ? lines.slice(1) : lines
    let imported = 0
    for (const line of dataLines) {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''))
      const typeKey = parts[1] || parts[0]
      if (!typeKey) continue
      try {
        await create.mutateAsync({ typeKey })
        imported++
      } catch {
        /* already exists or non-fatal */
      }
    }
    if (imported === 0) {
      setError('Could not import any automations. Check type keys.')
      return
    }
    onClose()
  }

  const createAgent = (key: string) => {
    if (create.isPending) return
    create.mutate({ typeKey: key }, { onSuccess: () => onClose() })
  }

  return (
    <FormSlideout
      title="Import Automations"
      width="640px"
      onClose={onClose}
    >
      <ImportModalTabs
        tabs={[
          { id: 'csv', label: 'CSV Upload' },
          { id: 'api', label: 'API Connections' },
          { id: 'starter', label: 'Starter Packs' },
          { id: 'catalog', label: 'Browse Templates' },
        ]}
        activeTab={tab}
        onSelectTab={setTab}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
        {tab === 'csv' && (
          <form className="budget-form" onSubmit={handleCsvSubmit}>
            <div className="budget-form-fields">
              <div className="budget-form-field">
                <label htmlFor="agents-import-csv">CSV</label>
                <textarea
                  id="agents-import-csv"
                  rows={8}
                  spellCheck={false}
                  autoFocus
                  placeholder={'name,typeKey\nDaily Team Brief,team-daily-brief\nDaily Customer Report,customer-daily-report'}
                  value={text}
                  onChange={(e) => { setText(e.target.value); setError('') }}
                />
              </div>
              <CsvExample
                example={'name,typeKey\nDaily Team Brief,team-daily-brief\nDaily Customer Report,customer-daily-report'}
                note="Columns: name, typeKey. Each row activates an automation in this workspace."
              />
              {error && <p className="budget-error" role="alert">{error}</p>}
            </div>
            <footer className="budget-form-actions" style={{ marginTop: 'var(--space-md)' }}>
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" className="budget-primary" disabled={!text.trim() || create.isPending}>
                {create.isPending ? 'Activating…' : 'Import Automations'}
              </button>
            </footer>
          </form>
        )}

        {tab === 'api' && (
          <ApiConnectionsPanel
            workspaceId={workspaceId}
            domain="automations"
            onClose={onClose}
          />
        )}

        {tab === 'starter' && (
          <StarterPackPicker
            domain="automations"
            confirmLabel="Import Automations"
            onImport={handleImportAutomations}
            onCancel={onClose}
          />
        )}

        {tab === 'catalog' && (
          <div className="agents-tables-stack" style={{ marginTop: 0 }}>
            {types.isLoading && <p className="agents-status">Loading templates…</p>}
            {types.isError && <p className="agents-status">Couldn’t load agent templates.</p>}
            {(types.data ?? []).map((t) => (
              <div
                key={t.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.75rem',
                  borderBottom: '1px solid var(--line)',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>{t.name}</strong>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {FAMILY_LABEL[t.family] ?? t.family} · {t.description}
                  </div>
                </div>
                <button
                  type="button"
                  className="section-add-btn"
                  style={{ flexShrink: 0 }}
                  disabled={create.isPending}
                  onClick={() => createAgent(t.key)}
                >
                  + Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </FormSlideout>
  )
}
