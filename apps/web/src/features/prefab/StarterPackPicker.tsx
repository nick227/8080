import { useState, useMemo } from 'react'
import {
  getPacksForDomain,
  getAllBlueprints,
  resolveImportPlan,
  type PrefabDomain,
  type PrefabPack,
  type PrefabRecord,
  type PrefabContact,
  type PrefabInventory,
  type PrefabTask,
  type PrefabTeamRole,
  type PrefabDocument,
  type PrefabAutomation,
} from '@project/shared'
import './prefab.css'

export type StarterPackPickerProps = {
  domain: PrefabDomain
  confirmLabel?: string
  onImport: (records: PrefabRecord<any>[], packName: string) => void
  onCancel?: () => void
}

export function StarterPackPicker({
  domain,
  confirmLabel = 'Import selected',
  onImport,
  onCancel,
}: StarterPackPickerProps) {
  const blueprints = useMemo(() => getAllBlueprints(), [])
  const packs = useMemo(() => getPacksForDomain(domain), [domain])
  const [customPacks, setCustomPacks] = useState<PrefabPack<any>[]>([])

  // Options: Full blueprint, individual domain packs, or uploaded community bundles
  const options = useMemo(() => {
    const list: Array<{ id: string; label: string; kind: 'blueprint' | 'pack' | 'custom' }> = []
    for (const bp of blueprints) {
      list.push({ id: `bp:${bp.slug}`, label: `${bp.name} (Full Blueprint)`, kind: 'blueprint' })
    }
    for (const p of packs) {
      list.push({ id: `pack:${p.id}`, label: p.name, kind: 'pack' })
    }
    for (const cp of customPacks) {
      list.push({ id: `custom:${cp.id}`, label: `${cp.name} (Community Package)`, kind: 'custom' })
    }
    return list
  }, [blueprints, packs, customPacks])

  const [selectedOptionId, setSelectedOptionId] = useState<string>(options[0]?.id ?? '')

  // Resolve active records and parent blueprint
  const { activeRecords, activeTitle, activeDescription, provenance, blueprintSlug, blueprintName } = useMemo(() => {
    if (selectedOptionId.startsWith('custom:')) {
      const packId = selectedOptionId.slice(7)
      const pack = customPacks.find((p) => p.id === packId)
      return {
        activeRecords: pack?.records ?? [],
        activeTitle: pack?.name ?? 'Community Package',
        activeDescription: pack?.description ?? 'Uploaded custom community package.',
        provenance: pack?.records[0]?.source,
        blueprintSlug: 'lean-service-team',
        blueprintName: 'Custom Bundle',
      }
    } else if (selectedOptionId.startsWith('bp:')) {
      const slug = selectedOptionId.slice(3)
      const plan = resolveImportPlan({ blueprintId: slug })
      const recs = plan.recordsByDomain[domain]
      const name = plan.blueprint?.name ?? 'Blueprint'
      return {
        activeRecords: recs,
        activeTitle: `${name} — ${domain.toUpperCase()}`,
        activeDescription: plan.blueprint?.description ?? '',
        provenance: recs[0]?.source,
        blueprintSlug: slug,
        blueprintName: name,
      }
    } else {
      const packId = selectedOptionId.slice(5)
      const pack = packs.find((p) => p.id === packId)
      const parentBp = blueprints.find((b) => {
        const bpPacks = (b.packs as Record<string, string[]>)?.[domain] ?? []
        return bpPacks.includes(packId)
      })
      const slug = parentBp?.slug ?? 'lean-service-team'
      const name = parentBp?.name ?? 'Lean Service Team'
      return {
        activeRecords: pack?.records ?? [],
        activeTitle: pack?.name ?? 'Starter Pack',
        activeDescription: pack?.description ?? '',
        provenance: pack?.records[0]?.source,
        blueprintSlug: slug,
        blueprintName: name,
      }
    }
  }, [selectedOptionId, domain, packs, blueprints, customPacks])

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(activeRecords.map((r) => r.key)))

  // Sync selection when active pack changes
  const handleSelectOption = (optId: string) => {
    setSelectedOptionId(optId)
    let nextRecords: PrefabRecord<any>[] = []
    if (optId.startsWith('custom:')) {
      const pack = customPacks.find((p) => p.id === optId.slice(7))
      nextRecords = pack?.records ?? []
    } else if (optId.startsWith('bp:')) {
      const plan = resolveImportPlan({ blueprintId: optId.slice(3) })
      nextRecords = plan.recordsByDomain[domain]
    } else {
      const pack = packs.find((p) => p.id === optId.slice(5))
      nextRecords = pack?.records ?? []
    }
    setSelectedKeys(new Set(nextRecords.map((r) => r.key)))
  }

  const toggleKey = (key: string) => {
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedKeys(next)
  }

  const toggleAll = () => {
    if (selectedKeys.size === activeRecords.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(activeRecords.map((r) => r.key)))
    }
  }

  const chosenRecords = activeRecords.filter((r) => selectedKeys.has(r.key))

  return (
    <div className="prefab-picker-wrap">
      <div className="prefab-pack-select-bar">
        <label htmlFor="starter-pack-select">Starter Pack:</label>
        <select
          id="starter-pack-select"
          className="prefab-pack-select"
          value={selectedOptionId}
          onChange={(e) => handleSelectOption(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        {provenance && (
          <span className={`prefab-badge ${provenance.provenance}`}>
            {provenance.provenance.replace('-', ' ')}
          </span>
        )}
      </div>

      <p className="prefab-pack-meta">{activeDescription}</p>



      <div className="prefab-preview-table-wrap">
        <table className="prefab-preview-table" aria-label="Starter records preview">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  aria-label="Select all records"
                  checked={activeRecords.length > 0 && selectedKeys.size === activeRecords.length}
                  onChange={toggleAll}
                />
              </th>
              {domain === 'contacts' && (
                <>
                  <th>Name & Title</th>
                  <th>Account</th>
                  <th>Email & Phone</th>
                  <th>Stage</th>
                </>
              )}
              {domain === 'inventory' && (
                <>
                  <th>Item Name</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                </>
              )}
              {domain === 'tasks' && (
                <>
                  <th>Task Title</th>
                  <th>Category</th>
                  <th>Allowance</th>
                  <th>Outcome ("Done means")</th>
                </>
              )}
              {domain === 'team' && (
                <>
                  <th>Role Title</th>
                  <th>Department</th>
                  <th>Capacity</th>
                  <th>Est. Rate</th>
                  <th>Required Skills</th>
                </>
              )}
              {domain === 'documents' && (
                <>
                  <th>Title</th>
                  <th>Kind</th>
                  <th>Summary</th>
                </>
              )}
              {domain === 'automations' && (
                <>
                  <th>Automation Name</th>
                  <th>Trigger / Schedule</th>
                  <th>Description</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {activeRecords.map((record) => {
              const isChecked = selectedKeys.has(record.key)
              return (
                <tr key={record.key} onClick={() => toggleKey(record.key)} style={{ cursor: 'pointer' }}>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleKey(record.key)}
                      aria-label={`Select ${record.key}`}
                    />
                  </td>
                  {domain === 'contacts' && <ContactRow contact={record as PrefabContact} />}
                  {domain === 'inventory' && <InventoryRow item={record as PrefabInventory} />}
                  {domain === 'tasks' && <TaskRow task={record as PrefabTask} />}
                  {domain === 'team' && <TeamRow role={record as PrefabTeamRole} />}
                  {domain === 'documents' && <DocumentRow doc={record as PrefabDocument} />}
                  {domain === 'automations' && <AutomationRow auto={record as PrefabAutomation} />}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="prefab-actions-bar">
        <span className="prefab-count-note">
          {chosenRecords.length} of {activeRecords.length} selected
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {onCancel && (
            <button type="button" className="cal-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="prefab-import-btn"
            disabled={chosenRecords.length === 0}
            onClick={() => onImport(chosenRecords, activeTitle)}
          >
            {confirmLabel} ({chosenRecords.length})
          </button>
        </div>
      </div>
    </div>
  )
}

function ContactRow({ contact }: { contact: PrefabContact }) {
  return (
    <>
      <td>
        <strong>{contact.displayName}</strong>
        <div style={{ fontSize: '0.78rem', color: '#999' }}>{contact.title}</div>
      </td>
      <td>{contact.accountName}</td>
      <td>
        <div>{contact.email}</div>
        <div style={{ fontSize: '0.78rem', color: '#888' }}>{contact.phone}</div>
      </td>
      <td>
        <span style={{ textTransform: 'capitalize', color: '#60a5fa' }}>{contact.stage}</span>
        <div style={{ fontSize: '0.72rem', color: '#aaa' }}>hypothetical</div>
      </td>
    </>
  )
}

function InventoryRow({ item }: { item: PrefabInventory }) {
  return (
    <>
      <td>
        <strong>{item.name}</strong>
        <div style={{ fontSize: '0.78rem', color: '#888' }}>{item.description}</div>
      </td>
      <td><code>{item.sku}</code></td>
      <td>{item.category}</td>
      <td>${item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      <td>{item.quantity}</td>
    </>
  )
}

function TaskRow({ task }: { task: PrefabTask }) {
  return (
    <>
      <td>
        <strong>{task.title}</strong>
        <div style={{ fontSize: '0.78rem', color: '#888' }}>{task.detail}</div>
      </td>
      <td><span className="prefab-ref-tag">{task.category}</span></td>
      <td>{task.minutes}m</td>
      <td>{task.outcome}</td>
    </>
  )
}

function TeamRow({ role }: { role: PrefabTeamRole }) {
  return (
    <>
      <td>
        <strong>{role.roleTitle}</strong>
        <div style={{ fontSize: '0.78rem', color: '#888' }}>{role.responsibilities}</div>
      </td>
      <td>{role.department}</td>
      <td>{role.hoursPerWeek} h/wk</td>
      <td>
        {role.estimatedRate
          ? `$${role.estimatedRate.amount.toLocaleString()}/${role.estimatedRate.period}`
          : '—'}
      </td>
      <td>
        {role.requiredSkills.map((s) => (
          <span key={s} className="prefab-ref-tag">
            {s}
          </span>
        ))}
      </td>
    </>
  )
}

function DocumentRow({ doc }: { doc: PrefabDocument }) {
  return (
    <>
      <td>
        <strong>{doc.title}</strong>
        {doc.requiresReview && (
          <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: '#f59e0b', border: '1px solid #f59e0b', padding: '1px 4px', borderRadius: '3px' }}>
            Legal Review
          </span>
        )}
      </td>
      <td><span className="prefab-ref-tag">{doc.kind}</span></td>
      <td>{doc.summary}</td>
    </>
  )
}

function AutomationRow({ auto }: { auto: PrefabAutomation }) {
  return (
    <>
      <td>
        <strong>{auto.name}</strong>
        <div style={{ fontSize: '0.78rem', color: '#888' }}>Type: {auto.typeKey}</div>
      </td>
      <td><code>{auto.scheduleHint}</code></td>
      <td>{auto.description}</td>
    </>
  )
}
