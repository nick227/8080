import { useState } from 'react'
import { FormSlideout } from '../work/FormSlideout'
import { ImportModalTabs } from '../prefab/ImportModalChrome'
import { StarterPackPicker } from '../prefab/StarterPackPicker'
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
  const [tab, setTab] = useState<string>('starter')
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
          { id: 'starter', label: 'Starter Packs' },
          { id: 'catalog', label: 'Browse Templates' },
        ]}
        activeTab={tab}
        onSelectTab={setTab}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
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

