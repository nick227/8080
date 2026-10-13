import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useAgents,
  useBudgetItems,
  useBudgetSummary,
  useContactCounts,
  useContacts,
  useInventory,
  useInventoryCounts,
  useMyRooms,
  useSession,
  useTaskReport,
  useTasks,
  useUpdateWorkspace,
  useUploadMedia,
  useWorkspaceInvites,
  useWorkspaceMembers,
} from '@project/sdk'
import { formatMinorMoney } from '@project/shared'
import {
  BellIcon,
  BookIcon,
  ChartMetricsIcon,
  ClockIcon,
  GridViewIcon,
  PersonIcon,
  SendIcon,
  UserCardIcon,
  WorkflowIcon,
} from '../../components/icons'
import { FormSlideout } from '../work/FormSlideout'
import { PeopleDialog } from '../team/PeopleDialog'
import { formatAgo } from '../../utils/time'
import { InlineList, InlineSelect, InlineText } from './Inline'
import { useCompanyProfile, type ListField, type ProfileChanges } from './useCompanyProfile'
import type { DeskLink } from './links'
import { NewTaskSlideout } from '../calendar/NewTaskSlideout'
import { RecordForm } from '../records/RecordForm'
import { NewBudgetItemSlideout } from '../budget/BudgetTable'
import { NewAgentSlideout } from '../agents/NewAgentSlideout'
import { useDocuments } from '../documents/store'
import { blankDoc } from '../documents/seed'
import type { DocumentRecord } from '../documents/types'
import '../budget/budget.css'
import '../agents/agents.css'
import './company-page.css'

type Workspace = { id: string; name: string; role: string; createdAt: string }
type Option = { value: string; label: string }

const options = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))
const ENTITY = options([
  ['sole_proprietorship', 'Sole proprietorship'],
  ['partnership', 'Partnership'],
  ['llc', 'LLC'],
  ['corporation', 'Corporation'],
  ['s_corporation', 'S corporation'],
  ['nonprofit', 'Nonprofit'],
  ['cooperative', 'Cooperative'],
  ['other', 'Other entity'],
])
const EMPLOYEES = options([
  ['1', '1 employee'],
  ['2-10', '2–10 employees'],
  ['11-50', '11–50 employees'],
  ['51-200', '51–200 employees'],
  ['201-1000', '201–1,000 employees'],
  ['1000+', '1,000+ employees'],
])
const REVENUE = options([
  ['under_100k', 'Under $100K revenue'],
  ['100k_500k', '$100K–$500K revenue'],
  ['500k_1m', '$500K–$1M revenue'],
  ['1m_5m', '$1M–$5M revenue'],
  ['5m_20m', '$5M–$20M revenue'],
  ['20m_100m', '$20M–$100M revenue'],
  ['100m_plus', '$100M+ revenue'],
])
const MODEL = options([
  ['b2b', 'B2B'],
  ['b2c', 'B2C'],
  ['b2b2c', 'B2B2C'],
  ['b2g', 'B2G'],
  ['d2c', 'Direct to consumer'],
  ['marketplace', 'Marketplace'],
])
const PRICING = options([
  ['fixed', 'Fixed price'],
  ['hourly', 'Hourly'],
  ['retainer', 'Retainer'],
  ['subscription', 'Subscription'],
  ['usage', 'Usage-based'],
  ['commission', 'Commission'],
  ['mixed', 'Mixed'],
])
const REACH = options([
  ['local', 'Local'],
  ['regional', 'Regional'],
  ['national', 'National'],
  ['global', 'Global'],
])
const VOICE = options([
  ['professional', 'Professional'],
  ['friendly', 'Friendly'],
  ['bold', 'Bold'],
  ['technical', 'Technical'],
])

const URL_HINT = 'Use a full address starting with https://'
const webUrl = (v: string) => {
  try {
    const url = new URL(v)
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? null : URL_HINT
  } catch {
    return URL_HINT
  }
}
const host = (v: string) => {
  try {
    return new URL(v).hostname.replace(/^www\./, '')
  } catch {
    return v
  }
}
const year = (v: string) =>
  /^\d{4}$/.test(v) && Number(v) >= 1800 && Number(v) <= new Date().getFullYear()
    ? null
    : `A year between 1800 and ${new Date().getFullYear()}`

type FieldDef = { key: string; label: string; filled: boolean; node: ReactNode }

export function CompanyPage({
  workspace,
  onGo,
  onSettings,
}: {
  workspace: Workspace
  onGo: (link: DeskLink) => void
  onSettings: () => void
}) {
  const canEdit = workspace.role === 'owner' || workspace.role === 'admin'
  const { profile, loading, failed, retry, save, list, error, clearError } = useCompanyProfile(workspace.id)
  const updateWorkspace = useUpdateWorkspace(workspace.id)
  const session = useSession()
  const ownerName = session.data?.data.displayName ?? 'You'

  // Modal / Slideout creation states
  const [addingEntity, setAddingEntity] = useState<'task' | 'contact' | 'inventory' | 'budget' | 'document' | 'agent' | null>(null)
  const [inviting, setInviting] = useState(false)
  const [openFacts, setOpenFacts] = useState(false)

  if (loading) return <p className="cp-status" role="status">Loading the company…</p>
  if (failed || !profile) {
    return (
      <p className="cp-status" role="alert">
        Couldn’t load the company profile. <button type="button" className="inline-link" onClick={retry}>Try again</button>
      </p>
    )
  }

  const p = profile
  const companyName = p.name || workspace.name
  const set = (key: keyof ProfileChanges) => (next: string | null) => save({ [key]: next } as ProfileChanges)
  const items = (key: ListField) => list(key).map((f) => ({ value: f.value, suggested: f.status === 'inferred' }))

  const rename = async (next: string | null) => {
    if (!next) return false
    try {
      await updateWorkspace.mutateAsync({ name: next })
    } catch {
      return false
    }
    return save({ name: next })
  }

  const facts: FieldDef[] = [
    {
      key: 'entityType',
      label: 'Entity type',
      filled: !!p.entityType,
      node: <InlineSelect value={p.entityType} options={ENTITY} canEdit={canEdit} label="Entity type" prompt="Entity type" onSave={set('entityType')} />,
    },
    {
      key: 'foundedYear',
      label: 'Founded',
      filled: p.foundedYear != null,
      node: (
        <InlineText
          value={p.foundedYear == null ? null : String(p.foundedYear)}
          canEdit={canEdit}
          label="Founded"
          prompt="Founded"
          maxLength={4}
          validate={year}
          onSave={(next) => save({ foundedYear: next == null ? null : Number(next) })}
        >
          Founded {p.foundedYear}
        </InlineText>
      ),
    },
    {
      key: 'location',
      label: 'Headquarters',
      filled: !!p.location,
      node: <InlineText value={p.location} canEdit={canEdit} label="Headquarters" prompt="Headquarters" maxLength={200} onSave={set('location')} />,
    },
    {
      key: 'sizeRange',
      label: 'Employees',
      filled: !!p.sizeRange,
      node: <InlineSelect value={p.sizeRange} options={EMPLOYEES} canEdit={canEdit} label="Employees" prompt="Employees" onSave={set('sizeRange')} />,
    },
    {
      key: 'revenueRange',
      label: 'Revenue',
      filled: !!p.revenueRange,
      node: <InlineSelect value={p.revenueRange} options={REVENUE} canEdit={canEdit} label="Revenue" prompt="Revenue" onSave={set('revenueRange')} />,
    },
    {
      key: 'businessModel',
      label: 'Model',
      filled: !!p.businessModel,
      node: <InlineSelect value={p.businessModel} options={MODEL} canEdit={canEdit} label="Model" prompt="Model" onSave={set('businessModel')} />,
    },
  ]
  const filledFacts = facts.filter((f) => f.filled)

  return (
    <article className="cp" aria-labelledby="cp-name">
      {/* ─── 1. Executive Identity & Inline Vitals ─────────────────────── */}
      <header className="cp-hero">
        <Logo workspace={workspace} companyName={companyName} logoUrl={p.logoUrl} canEdit={canEdit} onLogo={(id) => save({ logoMediaId: id })} />
        <div className="cp-identity">
          <h1 id="cp-name" className="cp-name">
            <InlineText
              value={companyName}
              canEdit={canEdit}
              required
              label="Company name"
              prompt="Name the company"
              maxLength={120}
              onSave={rename}
            />
          </h1>
          <p className="cp-subline">
            <InlineText value={p.legalName} canEdit={canEdit} label="Legal name" prompt="Legal name" maxLength={200} onSave={set('legalName')} />
            <span className="cp-subline-sep">·</span>
            <InlineText value={p.industry} canEdit={canEdit} label="Industry" prompt="Industry" maxLength={120} onSave={set('industry')} />
          </p>
          <div className="cp-description">
            <InlineText
              value={p.purpose}
              canEdit={canEdit}
              label="Business description"
              prompt="Add a one-paragraph business description"
              maxLength={1000}
              multiline
              onSave={set('purpose')}
            />
          </div>
          <div className="cp-facts" id="cp-facts">
            
              <div className="cp-facts-edit">
                {facts.map((f) => (
                  <label key={f.key} className="cp-facts-field">
                    <span>{f.label}</span>
                    {f.node}
                  </label>
                ))}
              </div>
                {filledFacts.map((f) => (
                  <span key={f.key} className="cp-pill">{f.node}</span>
                ))}
                {p.website && (
                  <a href={p.website} target="_blank" rel="noreferrer" className="cp-pill cp-pill-link">
                    {host(p.website)} ↗
                  </a>
                )}
                {canEdit && (
                  <button type="button" className="cp-pill cp-pill-add" onClick={() => setOpenFacts(true)}>
                    {filledFacts.length ? 'Edit company facts' : '+ Add company facts'}
                  </button>
                )}

          </div>
        </div>
        <div className="cp-hero-side">
          <div className="cp-actions">
            {canEdit && <button type="button" className="cp-action" onClick={() => setInviting(true)}>Invite team</button>}
            <button
              type="button"
              className="cp-action cp-gear"
              onClick={onSettings}
              aria-label="Company settings"
              title="Company settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.6 3.3.9.7-1.2 2.1-1.1-.4a4.8 4.8 0 0 1-1.4.8L10.6 13H8.2l-.2-1a4.8 4.8 0 0 1-1.4-.8l-1.1.4-1.2-2.1.9-.7a4.8 4.8 0 0 1 0-1.6l-.9-.7 1.2-2.1 1.1.4c.4-.3.9-.6 1.4-.8l.2-1h2.4l.2 1c.5.2 1 .5 1.4.8l1.1-.4 1.2 2.1-.9.7a4.8 4.8 0 0 1 0 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p className="cp-error" role="alert">
          {error} <button type="button" className="inline-link" onClick={clearError}>Dismiss</button>
        </p>
      )}

      {/* ─── 2. Live Operations / "Active Now" Radar ───────────────────── */}
      <ActiveOperations workspaceId={workspace.id} onGo={onGo} />

      {/* ─── 3. The 6 Entity Command Cards ────────────────────────────── */}
      <section className="cp-entities-section" aria-labelledby="cp-entities-heading">
        <div className="cp-section-header">
          <h2 id="cp-entities-heading" className="cp-section-title">Workspace Operations</h2>
          <span className="cp-section-sub">Live management and overview of all 6 workspace domains</span>
        </div>
        <div className="cp-entities-grid">
          <TasksCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'tasks' })}
            onAdd={() => setAddingEntity('task')}
          />
          <ContactsCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'contacts' })}
            onAdd={() => setAddingEntity('contact')}
          />
          <InventoryCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'inventory' })}
            onAdd={() => setAddingEntity('inventory')}
          />
          <BudgetCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'budget' })}
            onAdd={() => setAddingEntity('budget')}
          />
          <DocumentsCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'documents' })}
            onAdd={() => setAddingEntity('document')}
          />
          <AgentsCard
            workspaceId={workspace.id}
            onGo={() => onGo({ desk: 'agents' })}
            onAdd={() => setAddingEntity('agent')}
          />
        </div>
      </section>

      {/* ─── 4. Consolidated Company Profile (Conventional Form Fields) ── */}
      <CompanyDetailsForm
        profile={p}
        canEdit={canEdit}
        onSave={save}
        list={list}
      />

      {/* ─── 5. Team Card ─────────────────────────────────────────────── */}
      <TeamCard workspace={workspace} onInvite={canEdit ? () => setInviting(true) : undefined} />

      {/* ─── On-Page Entity Creation Modals / Slideouts ───────────────── */}
      {addingEntity === 'task' && (
        <NewTaskSlideout
          initialDay={new Date().toISOString().slice(0, 10)}
          onClose={() => setAddingEntity(null)}
        />
      )}

      {addingEntity === 'contact' && (
        <RecordForm
          kind="contacts"
          workspaceId={workspace.id}
          onClose={() => setAddingEntity(null)}
          onSaved={() => setAddingEntity(null)}
        />
      )}

      {addingEntity === 'inventory' && (
        <RecordForm
          kind="inventory"
          workspaceId={workspace.id}
          onClose={() => setAddingEntity(null)}
          onSaved={() => setAddingEntity(null)}
        />
      )}

      {addingEntity === 'budget' && (
        <NewBudgetItemSlideout
          workspaceId={workspace.id}
          initialDirection="expense"
          onClose={() => setAddingEntity(null)}
          onCreated={() => setAddingEntity(null)}
        />
      )}

      {addingEntity === 'document' && (
        <NewDocumentSlideout
          owner={ownerName}
          onClose={() => setAddingEntity(null)}
          onCreated={() => {
            setAddingEntity(null)
            onGo({ desk: 'documents' })
          }}
        />
      )}

      {addingEntity === 'agent' && (
        <NewAgentSlideout
          workspaceId={workspace.id}
          onClose={() => setAddingEntity(null)}
          onCreated={() => setAddingEntity(null)}
        />
      )}

      {inviting && <PeopleDialog workspace={workspace} onClose={() => setInviting(false)} />}
    </article>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Zone 2: Active Operations ("Active Now") Banner
   ───────────────────────────────────────────────────────────────────────────── */

function ActiveOperations({ workspaceId, onGo }: { workspaceId: string; onGo: (link: DeskLink) => void }) {
  const agentsQuery = useAgents(workspaceId)
  const taskReport = useTaskReport(workspaceId, 1)
  const tasksQuery = useTasks(workspaceId)
  const roomsQuery = useMyRooms({ limit: 5 })

  const agents = agentsQuery.data ?? []
  const activeAgents = agents.filter((a) => a.status === 'active')

  const now = taskReport.data?.now
  const tasks = tasksQuery.data ?? []
  const doingTasks = tasks.filter((t) => t.status === 'doing')
  const doingCount = now?.doing ?? doingTasks.length
  const blockedCount = now?.blocked ?? tasks.filter((t) => t.status === 'blocked').length

  const activeRooms = roomsQuery.data?.pages?.flatMap((p) => p.data ?? []) ?? []

  return (
    <section className="cp-active-radar" aria-label="Active workspace operations">
      <div className="cp-radar-pill cp-radar-header">
        <span className="cp-live-dot" aria-hidden="true" />
        <span className="cp-radar-tag">ACTIVE NOW</span>
      </div>

      <div className="cp-radar-grid">
        {/* Running Automations */}
        <button
          type="button"
          className="cp-radar-item"
          onClick={() => onGo({ desk: 'agents' })}
          data-highlight={activeAgents.length > 0 ? '' : undefined}
        >
          <span className="cp-radar-icon"><WorkflowIcon /></span>
          <div className="cp-radar-text">
            <span className="cp-radar-count">
              {agentsQuery.isLoading ? '…' : `${activeAgents.length} ${activeAgents.length === 1 ? 'Agent' : 'Agents'} Active`}
            </span>
            <span className="cp-radar-desc">
              {activeAgents.length > 0
                ? activeAgents.map((a) => a.name).slice(0, 2).join(', ')
                : 'No background automations running'}
            </span>
          </div>
        </button>

        {/* Tasks in Flight */}
        <button
          type="button"
          className="cp-radar-item"
          onClick={() => onGo({ desk: 'tasks' })}
          data-highlight={doingCount > 0 ? '' : undefined}
        >
          <span className="cp-radar-icon"><ClockIcon /></span>
          <div className="cp-radar-text">
            <span className="cp-radar-count">
              {doingCount > 0 ? `${doingCount} In Progress` : '0 Tasks in Progress'}
            </span>
            <span className="cp-radar-desc">
              {doingTasks.length > 0
                ? doingTasks[0].title
                : now?.todo ? `${now.todo} queued in backlog` : 'All tasks up to date'}
            </span>
          </div>
        </button>

        {/* Live Channels / Rooms */}
        <button
          type="button"
          className="cp-radar-item"
          onClick={() => onGo({ desk: 'stream' })}
        >
          <span className="cp-radar-icon"><UserCardIcon /></span>
          <div className="cp-radar-text">
            <span className="cp-radar-count">
              {activeRooms.length > 0 ? `${activeRooms.length} Live Spaces` : 'Spaces Ready'}
            </span>
            <span className="cp-radar-desc">
              {activeRooms.length > 0 ? activeRooms[0].topic || 'Collaborative room' : 'Team stream available'}
            </span>
          </div>
        </button>

        {/* Blockers & Attention */}
        <button
          type="button"
          className="cp-radar-item cp-radar-alert"
          onClick={() => onGo({ desk: 'tasks' })}
          data-alert={blockedCount > 0 ? '' : undefined}
        >
          <span className="cp-radar-icon"><BellIcon /></span>
          <div className="cp-radar-text">
            <span className="cp-radar-count">
              {blockedCount > 0 ? `${blockedCount} Blocked Items` : '0 Blockers'}
            </span>
            <span className="cp-radar-desc">
              {blockedCount > 0 ? 'Requires attention' : 'Execution flowing smoothly'}
            </span>
          </div>
        </button>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Zone 3: The 6 Entity Command Cards
   ───────────────────────────────────────────────────────────────────────────── */

function TasksCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const report = useTaskReport(workspaceId, 1)
  const tasksQuery = useTasks(workspaceId)
  const now = report.data?.now
  const list = tasksQuery.data ?? []
  const doing = list.filter((t) => t.status === 'doing')
  const todo = list.filter((t) => t.status === 'todo')
  const recent = [...doing, ...todo].slice(0, 3)

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-tasks">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><ClockIcon /></span>
          <div>
            <h3 id="cp-card-tasks" className="cp-entity-title">Tasks</h3>
            <span className="cp-entity-metric">
              {now ? `${now.doing} doing · ${now.todo} todo` : 'Work execution'}
            </span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {recent.length > 0 ? (
          recent.map((task) => (
            <li key={task.id} className="cp-feed-row" onClick={onGo}>
              <span className={`cp-task-pill cp-task-${task.status}`}>{task.status}</span>
              <span className="cp-feed-label">{task.title}</span>
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No active tasks right now.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Tasks ↗</button>
      </footer>
    </section>
  )
}

function ContactsCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const counts = useContactCounts(workspaceId)
  const contacts = useContacts(workspaceId, { limit: 3 })
  const list = contacts.data?.pages?.[0]?.data ?? []

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-contacts">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><PersonIcon guest={false} /></span>
          <div>
            <h3 id="cp-card-contacts" className="cp-entity-title">Contacts & CRM</h3>
            <span className="cp-entity-metric">
              {counts.data ? `${counts.data.all ?? 0} total records` : 'Relationships & leads'}
            </span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {list.length > 0 ? (
          list.map((c) => (
            <li key={c.id} className="cp-feed-row" onClick={onGo}>
              <span className="cp-contact-avatar" aria-hidden="true">
                {c.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="cp-feed-label">{c.displayName}</span>
              {c.primaryEmail && <span className="cp-feed-detail">{c.primaryEmail}</span>}
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No contacts recorded yet.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Contacts ↗</button>
      </footer>
    </section>
  )
}

function InventoryCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const counts = useInventoryCounts(workspaceId)
  const inventory = useInventory(workspaceId, { limit: 3 })
  const list = inventory.data?.pages?.[0]?.data ?? []

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-inventory">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><GridViewIcon /></span>
          <div>
            <h3 id="cp-card-inventory" className="cp-entity-title">Inventory</h3>
            <span className="cp-entity-metric">
              {counts.data ? `${counts.data.all ?? 0} SKUs · ${counts.data.low ?? 0} low` : 'Products & stock'}
            </span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {list.length > 0 ? (
          list.map((item) => (
            <li key={item.id} className="cp-feed-row" onClick={onGo}>
              <span className="cp-feed-label">{item.name}</span>
              <span className="cp-feed-badge" data-low={item.quantity != null && item.quantity <= 5 ? '' : undefined}>
                {item.quantity ?? 0} in stock
              </span>
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No inventory items tracked yet.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Inventory ↗</button>
      </footer>
    </section>
  )
}

function BudgetCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const budget = useBudgetSummary(workspaceId)
  const itemsQuery = useBudgetItems(workspaceId, { limit: 3 })
  const b = budget.data
  const list = itemsQuery.data?.data ?? []

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-budget">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><ChartMetricsIcon /></span>
          <div>
            <h3 id="cp-card-budget" className="cp-entity-title">Budgets</h3>
            <span className="cp-entity-metric">
              {b ? `${b.netBalanceMinor >= 0 ? '+' : ''}${formatMinorMoney(b.netBalanceMinor, b.currency)} net` : 'Financial health'}
            </span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {list.length > 0 ? (
          list.map((item) => (
            <li key={item.id} className="cp-feed-row" onClick={onGo}>
              <span className={`cp-money-dir cp-money-${item.direction}`}>
                {item.direction === 'income' ? '↑' : '↓'}
              </span>
              <span className="cp-feed-label">{item.title}</span>
              <span className="cp-feed-detail">{formatMinorMoney(item.amountMinor, 'USD')}</span>
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No recent budget items logged.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Budget ↗</button>
      </footer>
    </section>
  )
}

function DocumentsCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const docs = useDocuments((state) => state.docs)
  const recent = docs.slice(0, 3)

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-documents">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><BookIcon /></span>
          <div>
            <h3 id="cp-card-documents" className="cp-entity-title">Documents</h3>
            <span className="cp-entity-metric">{docs.length} documents & specs</span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {recent.length > 0 ? (
          recent.map((doc) => (
            <li key={doc.id} className="cp-feed-row" onClick={onGo}>
              <span className="cp-doc-surface">{doc.surface === 'grid' ? 'Sheet' : doc.surface === 'mental_map' ? 'Map' : 'Doc'}</span>
              <span className="cp-feed-label">{doc.title || 'Untitled'}</span>
              <span className="cp-feed-detail">{formatAgo(new Date(doc.updatedAt).toISOString())}</span>
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No documents created yet.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Documents ↗</button>
      </footer>
    </section>
  )
}

function AgentsCard({ workspaceId, onGo, onAdd }: { workspaceId: string; onGo: () => void; onAdd: () => void }) {
  const agentsQuery = useAgents(workspaceId)
  const agents = agentsQuery.data ?? []
  const activeCount = agents.filter((a) => a.status === 'active').length
  const recent = agents.slice(0, 3)

  return (
    <section className="cp-entity-card" aria-labelledby="cp-card-agents">
      <header className="cp-entity-head">
        <div className="cp-entity-title-group">
          <span className="cp-entity-icon" aria-hidden="true"><WorkflowIcon /></span>
          <div>
            <h3 id="cp-card-agents" className="cp-entity-title">Automations</h3>
            <span className="cp-entity-metric">{activeCount} active · {agents.length} configured</span>
          </div>
        </div>
        <button type="button" className="cp-entity-add" onClick={onAdd}>+ Add</button>
      </header>

      <ul className="cp-entity-feed">
        {recent.length > 0 ? (
          recent.map((agent) => (
            <li key={agent.id} className="cp-feed-row" onClick={onGo}>
              <span className={`cp-agent-dot cp-agent-${agent.status}`} aria-hidden="true" />
              <span className="cp-feed-label">{agent.name}</span>
              <span className="cp-feed-badge">{agent.status}</span>
            </li>
          ))
        ) : (
          <li className="cp-feed-empty">No automations configured yet.</li>
        )}
      </ul>

      <footer className="cp-entity-foot">
        <button type="button" className="cp-entity-link" onClick={onGo}>Open Automations ↗</button>
      </footer>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Zone 4: Consolidated Company Profile (Conventional Form Fields & Textareas)
   ───────────────────────────────────────────────────────────────────────────── */

function CompanyDetailsForm({
  profile,
  canEdit,
  onSave,
  list,
}: {
  profile: any
  canEdit: boolean
  onSave: (changes: ProfileChanges) => Promise<boolean>
  list: (field: ListField) => { value: string; status?: string }[]
}) {
  const p = profile
  const set = (key: keyof ProfileChanges) => (next: string | null) => onSave({ [key]: next } as ProfileChanges)
  const items = (key: ListField) => list(key).map((f) => ({ value: f.value, suggested: f.status === 'inferred' }))

  return (
    <section className="cp-form-section" aria-labelledby="cp-form-title">
      <div className="cp-section-header">
        <h2 id="cp-form-title" className="cp-section-title">Company Profile & Operations</h2>
        <span className="cp-section-sub">
          Core strategy, market context, brand voice, and operational details
        </span>
      </div>

      <div className="cp-form-groups-grid">
        {/* Group 1: Strategy & Purpose */}
        <div className="cp-form-group-card">
          <h3 className="cp-group-title">
            <span className="cp-group-icon"><ChartMetricsIcon /></span> Strategy & Mission
          </h3>

          <ConventionalTextarea
            id="cp-mission"
            label="Mission Statement"
            placeholder="Why does the company exist?"
            value={p.mission}
            canEdit={canEdit}
            onSave={set('mission')}
          />

          <ConventionalTextarea
            id="cp-vision"
            label="Vision"
            placeholder="Where is the company heading in the long term?"
            value={p.vision}
            canEdit={canEdit}
            onSave={set('vision')}
          />

          <ConventionalTextarea
            id="cp-valprop"
            label="Value Proposition"
            placeholder="What unique value do you deliver to your customers?"
            value={p.valueProposition}
            canEdit={canEdit}
            onSave={set('valueProposition')}
          />

          <div className="cp-form-field">
            <span className="cp-form-label">Strategic Objectives</span>
            <InlineList
              items={items('goals')}
              canEdit={canEdit}
              label="Strategic objectives"
              prompt="Add an objective"
              addLabel="Add objective"
              onSave={(next) => onSave({ goals: next } as ProfileChanges)}
            />
          </div>
        </div>

        {/* Group 2: Target Market & Offerings */}
        <div className="cp-form-group-card">
          <h3 className="cp-group-title">
            <span className="cp-group-icon"><PersonIcon guest={false} /></span> Market & Offerings
          </h3>

          <ConventionalTextarea
            id="cp-ideal-customer"
            label="Ideal Customer Profile"
            placeholder="Describe your ideal target persona or organization..."
            value={p.idealCustomer}
            canEdit={canEdit}
            onSave={set('idealCustomer')}
          />

          <div className="cp-form-field">
            <span className="cp-form-label">Products & Offerings</span>
            <InlineList
              items={items('offerings')}
              canEdit={canEdit}
              label="Offerings"
              prompt="Add an offering"
              addLabel="Add product/service"
              onSave={(next) => onSave({ offerings: next } as ProfileChanges)}
            />
          </div>

          <div className="cp-form-field">
            <span className="cp-form-label">Competitive Advantages</span>
            <InlineList
              items={items('differentiators')}
              canEdit={canEdit}
              label="Competitive advantages"
              prompt="Add a differentiator"
              addLabel="Add advantage"
              onSave={(next) => onSave({ differentiators: next } as ProfileChanges)}
            />
          </div>

          <div className="cp-form-field">
            <span className="cp-form-label">Key Competitors</span>
            <InlineList
              items={items('competitors')}
              canEdit={canEdit}
              label="Competitors"
              prompt="Add a competitor"
              addLabel="Add competitor"
              onSave={(next) => onSave({ competitors: next } as ProfileChanges)}
            />
          </div>
        </div>

        {/* Group 3: Brand & Positioning */}
        <div className="cp-form-group-card">
          <h3 className="cp-group-title">
            <span className="cp-group-icon"><BookIcon /></span> Brand & Positioning
          </h3>

          <ConventionalSelect
            id="cp-brand-voice"
            label="Brand Voice"
            value={p.brandVoice}
            options={VOICE}
            canEdit={canEdit}
            onSave={set('brandVoice')}
          />

          <ConventionalSelect
            id="cp-reach"
            label="Geographic Reach"
            value={p.serviceArea}
            options={REACH}
            canEdit={canEdit}
            onSave={set('serviceArea')}
          />

          <ConventionalSelect
            id="cp-pricing"
            label="Pricing Model"
            value={p.pricingModel}
            options={PRICING}
            canEdit={canEdit}
            onSave={set('pricingModel')}
          />

          <div className="cp-form-field">
            <span className="cp-form-label">Preferred Terminology</span>
            <InlineList
              items={items('terms')}
              canEdit={canEdit}
              label="Preferred terminology"
              prompt="Add a preferred term"
              addLabel="Add term"
              onSave={(next) => onSave({ terms: next } as ProfileChanges)}
            />
          </div>
        </div>

        {/* Group 4: Contact & Operations */}
        <div className="cp-form-group-card">
          <h3 className="cp-group-title">
            <span className="cp-group-icon"><SendIcon /></span> Contact & Operations
          </h3>

          <ConventionalInput
            id="cp-email"
            label="Business Email"
            type="email"
            placeholder="hello@company.com"
            value={p.email}
            canEdit={canEdit}
            onSave={set('email')}
          />

          <ConventionalInput
            id="cp-phone"
            label="Business Phone"
            type="tel"
            placeholder="+1 (555) 000-0000"
            value={p.phone}
            canEdit={canEdit}
            onSave={set('phone')}
          />

          <ConventionalInput
            id="cp-hours"
            label="Business Hours"
            type="text"
            placeholder="Mon–Fri 9:00 AM – 5:00 PM EST"
            value={p.hours}
            canEdit={canEdit}
            onSave={set('hours')}
          />

          <ConventionalInput
            id="cp-website"
            label="Company Website"
            type="url"
            placeholder="https://company.com"
            value={p.website}
            canEdit={canEdit}
            onSave={set('website')}
          />

          <div className="cp-form-field">
            <span className="cp-form-label">Web & Social Links</span>
            <InlineList
              items={items('links')}
              canEdit={canEdit}
              label="Social profiles"
              prompt="Add a profile link"
              addLabel="Add link"
              validate={webUrl}
              onSave={(next) => onSave({ links: next } as ProfileChanges)}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Conventional Form Controls
   ───────────────────────────────────────────────────────────────────────────── */

function ConventionalInput({
  id,
  label,
  value,
  type = 'text',
  placeholder,
  canEdit,
  onSave,
}: {
  id: string
  label: string
  value: string | null | undefined
  type?: string
  placeholder?: string
  canEdit: boolean
  onSave: (val: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [dirty, setDirty] = useState(false)

  // Sync external changes
  const prevVal = useRef(value)
  if (prevVal.current !== value) {
    prevVal.current = value
    setDraft(value ?? '')
    setDirty(false)
  }

  const commit = () => {
    if (!dirty) return
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '')) {
      onSave(trimmed || null)
    }
    setDirty(false)
  }

  return (
    <div className="cp-form-field">
      <label htmlFor={id} className="cp-form-label">{label}</label>
      <input
        id={id}
        type={type}
        className="cp-conventional-input"
        placeholder={placeholder}
        value={draft}
        disabled={!canEdit}
        onChange={(e) => {
          setDraft(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function ConventionalTextarea({
  id,
  label,
  value,
  placeholder,
  rows = 3,
  canEdit,
  onSave,
}: {
  id: string
  label: string
  value: string | null | undefined
  placeholder?: string
  rows?: number
  canEdit: boolean
  onSave: (val: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [dirty, setDirty] = useState(false)

  const prevVal = useRef(value)
  if (prevVal.current !== value) {
    prevVal.current = value
    setDraft(value ?? '')
    setDirty(false)
  }

  const commit = () => {
    if (!dirty) return
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '')) {
      onSave(trimmed || null)
    }
    setDirty(false)
  }

  return (
    <div className="cp-form-field">
      <label htmlFor={id} className="cp-form-label">{label}</label>
      <textarea
        id={id}
        rows={rows}
        className="cp-conventional-textarea"
        placeholder={placeholder}
        value={draft}
        disabled={!canEdit}
        onChange={(e) => {
          setDraft(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
      />
    </div>
  )
}

function ConventionalSelect({
  id,
  label,
  value,
  options: opts,
  canEdit,
  onSave,
}: {
  id: string
  label: string
  value: string | null | undefined
  options: Option[]
  canEdit: boolean
  onSave: (val: string | null) => void
}) {
  return (
    <div className="cp-form-field">
      <label htmlFor={id} className="cp-form-label">{label}</label>
      <select
        id={id}
        className="cp-conventional-select"
        value={value ?? ''}
        disabled={!canEdit}
        onChange={(e) => onSave(e.target.value || null)}
      >
        <option value="">Choose...</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   New Document Slideout Helper
   ───────────────────────────────────────────────────────────────────────────── */

function NewDocumentSlideout({
  owner,
  onClose,
  onCreated,
}: {
  owner: string
  onClose: () => void
  onCreated: () => void
}) {
  const [surface, setSurface] = useState<DocumentRecord['surface']>('blocks')
  const [title, setTitle] = useState('')
  const add = useDocuments((state) => state.add)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const doc = blankDoc(surface, owner)
    if (title.trim()) {
      doc.title = title.trim()
    }
    add(doc)
    onCreated()
  }

  return (
    <FormSlideout title="New document" onClose={onClose}>
      <form className="record-form" onSubmit={handleSubmit}>
        <div className="record-form-fields">
          <label>
            <span>Title</span>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Project Roadmap"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            <span>Document type</span>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value as DocumentRecord['surface'])}
            >
              <option value="blocks">Document (Text & Blocks)</option>
              <option value="grid">Sheet (Spreadsheet)</option>
              <option value="mental_map">Map (Mind Map / Visual)</option>
            </select>
          </label>
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="record-primary">Create Document</button>
        </footer>
      </form>
    </FormSlideout>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Supporting Components: Logo & TeamCard
   ───────────────────────────────────────────────────────────────────────────── */

function Logo({
  workspace,
  companyName,
  logoUrl,
  canEdit,
  onLogo,
}: {
  workspace: Workspace
  companyName?: string
  logoUrl: string | null
  canEdit: boolean
  onLogo: (mediaId: string | null) => Promise<boolean>
}) {
  const uploadMedia = useUploadMedia()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const initial = (companyName || workspace.name).trim().charAt(0).toUpperCase() || '·'

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setProblem('')
    try {
      const media = await uploadMedia.mutateAsync({ file, type: 'image', name: file.name })
      await onLogo(media.id)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t upload the logo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cp-logo-wrap">
      <div className="cp-logo">
        {logoUrl ? <img src={logoUrl} alt="" /> : <span aria-hidden="true">{initial}</span>}
        {canEdit && (
          <button
            type="button"
            className="cp-logo-edit"
            disabled={busy}
            onClick={() => input.current?.click()}
            aria-label={logoUrl ? 'Change logo' : 'Add a logo'}
          >
            {busy ? '…' : logoUrl ? 'Change' : 'Add logo'}
          </button>
        )}
        {canEdit && logoUrl && (
          <button
            type="button"
            className="cp-logo-remove"
            onClick={() => void onLogo(null)}
            aria-label="Remove logo"
            title="Remove logo"
          >
            ×
          </button>
        )}
      </div>
      {problem && <p className="cp-error" role="alert">{problem}</p>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

function TeamCard({ workspace, onInvite }: { workspace: Workspace; onInvite?: () => void }) {
  const members = useWorkspaceMembers(workspace.id)
  const invites = useWorkspaceInvites(workspace.id)
  const people = (members.data ?? []).filter((m) => m.status === 'active')
  const pending = invites.isError ? 0 : (invites.data?.length ?? 0)

  return (
    <section className="cp-team-section" aria-labelledby="cp-team-title">
      <header className="cp-section-header">
        <div>
          <h2 id="cp-team-title" className="cp-section-title">Team Roster</h2>
          <span className="cp-section-sub">
            {people.length} {people.length === 1 ? 'member' : 'members'}{pending > 0 ? ` · ${pending} invited` : ''}
          </span>
        </div>
        {onInvite && (
          <button type="button" className="cp-action" onClick={onInvite}>+ Invite member</button>
        )}
      </header>
      <ul className="cp-faces">
        {people.slice(0, 16).map((m) => (
          <li key={m.id} title={m.user.name ?? m.email ?? ''} className="cp-face-item">
            {m.user.avatarUrl ? (
              <img src={m.user.avatarUrl} alt="" className="cp-face-avatar" />
            ) : (
              <span className="cp-face-placeholder" aria-hidden="true">
                {(m.user.name ?? m.email ?? '?').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="cp-face-name">{(m.user.name ?? m.email ?? '').split(' ')[0]}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
