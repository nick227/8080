import { WorkspaceLoading } from '../work/WorkspaceTransition'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useBudgetItems,
  useBudgetSummary,
  useCreateBudgetItem,
  useUpdateBudgetItem,
  useDeleteBudgetItem,
  useImportBudgetItems,
  useContacts,
  type BudgetItem,
  type BudgetDirection,
  type BudgetStatus,
  type BudgetCategory,
  type BudgetSummary,
} from '@project/sdk'
import {
  BUDGET_CATEGORIES,
  BUDGET_INCOME_CATEGORIES,
  BUDGET_EXPENSE_CATEGORIES,
  BUDGET_STATUS_LABELS,
  formatMinorMoney,
  type BudgetCategoryKey,
  type BudgetIncomeCategoryKey,
  type BudgetExpenseCategoryKey,
} from '@project/shared'
import { CsvExample } from '../../components/CsvExample'
import { CollectionView } from '../collections/CollectionView'
import { ColumnsMenu, FilterChips } from '../collections/ColumnsMenu'
import { DataTable } from '../collections/DataTable'
import { useTableState, type Column } from '../collections/table'
import { BulkMessage, SelectionBar, deleteColumn, useBulkDelete, useSelection } from '../collections/selection'
import '../documents/DocumentsList.css'
import { parseBudgetCsv } from './importParse'
import { blueprints, scenarioData } from '../blueprints/data'
import { FormSlideout } from '../work/FormSlideout'
import { ImportModalTabs } from '../prefab/ImportModalChrome'
import '../prefab/prefab.css'
import './budget.css'

export function BudgetTable({ workspaceId }: { workspaceId: string }) {
  const [activeTab, setActiveTab] = useState<'all' | 'income' | 'expense'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<'new' | 'import' | null>(null)
  const [notice, setNotice] = useState('')

  // Queries
  const queryParams = useMemo(() => {
    return {
      direction: activeTab === 'all' ? undefined : (activeTab as BudgetDirection),
      category: categoryFilter === 'all' ? undefined : (categoryFilter as BudgetCategory),
      status: statusFilter === 'all' ? undefined : (statusFilter as BudgetStatus),
      search: search.trim() || undefined,
      sort: 'date' as const,
      dir: 'asc' as const,
      limit: 100,
    }
  }, [activeTab, categoryFilter, statusFilter, search])

  const { data: budgetData, isLoading, refetch } = useBudgetItems(workspaceId, queryParams)
  const { data: summary } = useBudgetSummary(workspaceId)

  const items = useMemo(() => budgetData?.data ?? [], [budgetData])
  const totalCount = budgetData?.total ?? 0
  const update = useUpdateBudgetItem(workspaceId)
  const deleteItem = useDeleteBudgetItem(workspaceId)
  const removal = useBulkDelete({ noun: { one: 'budget item', many: 'budget items' }, remove: deleteItem.mutateAsync, done: () => void refetch() })
  const columns = useBudgetColumns(update, removal.run, () => void refetch())
  const table = useTableState('budget', columns, { id: 'date', dir: 1 })
  // Ties keep the server's order (by date).
  const rows = table.sortRows(items)
  const selection = useSelection(useMemo(() => rows.map((item) => item.id), [rows]))

  return (
    <div className="budget-experience">
      {/* Collection Tabular View */}
      <CollectionView
        collection="budget"
        count={totalCount}
        onNew={() => setPanel('new')}
        onImport={() => setPanel('import')}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search budget descriptions and notes…',
        }}
        filters={
          <>
            <FilterChips
              label="Budget type"
              value={activeTab}
              options={[
                { id: 'all', label: 'All' },
                { id: 'income', label: 'Income' },
                { id: 'expense', label: 'Expenses' },
              ]}
              onChange={(tab) => {
                setActiveTab(tab)
                setCategoryFilter('all')
              }}
            />

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All Categories</option>
              {activeTab === 'all' || activeTab === 'income'
                ? Object.entries(BUDGET_INCOME_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      In: {label}
                    </option>
                  ))
                : null}
              {activeTab === 'all' || activeTab === 'expense'
                ? Object.entries(BUDGET_EXPENSE_CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      Ex: {label}
                    </option>
                  ))
                : null}
            </select>

            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="planned">Planned</option>
              <option value="pending">Pending</option>
              <option value="cleared">Cleared</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </>
        }
        view={<><BudgetTotals summary={summary} /><ColumnsMenu state={table} /></>}
        notice={<>
          {notice && <p className="collection-note" role="status">{notice}</p>}
          <BulkMessage result={removal.result} onDismiss={removal.dismiss} />
        </>}
      >
        {isLoading ? (
          <WorkspaceLoading label="Loading budget…" />
        ) : items.length === 0 ? (
          <div className="budget-empty">
            <h3>No budget items found</h3>
            <p>Add planned income or expense allowances to track aggregate totals and calendar dates.</p>
            <button
              type="button"
              className="section-add-btn"
              onClick={() => setPanel('new')}
            >
              + Add budget entry
            </button>
          </div>
        ) : (
          <DataTable
            label="Budget register"
            rows={rows}
            getId={(item) => item.id}
            state={table}
            tableClass="budget-table"
            selection={{ selected: selection.selected, onChange: selection.set }}
          />
        )}
        <SelectionBar count={selection.selected.size} onClear={selection.clear} busy={removal.busy} onDelete={() => void removal.run(selection.ids)} />
      </CollectionView>

      {panel === 'new' && (
        <NewBudgetItemSlideout
          workspaceId={workspaceId}
          initialDirection={activeTab === 'expense' ? 'expense' : 'income'}
          onClose={() => setPanel(null)}
          onCreated={() => {
            setPanel(null)
            void refetch()
          }}
        />
      )}
      {panel === 'import' && (
        <ImportBudgetSlideout
          workspaceId={workspaceId}
          onClose={() => setPanel(null)}
          onImported={(count) => {
            setPanel(null)
            setNotice(`Imported ${count} budget ${count === 1 ? 'item' : 'items'}.`)
            void refetch()
          }}
        />
      )}
    </div>
  )
}

/** Income, expenses, net and pending as one line on the right of the controls bar. */
function BudgetTotals({ summary }: { summary?: BudgetSummary }) {
  if (!summary?.itemCount) return null
  const currency = summary.currency ?? 'USD'
  const net = summary.netBalanceMinor ?? 0
  const pending = (summary.pendingIncomeMinor ?? 0) + (summary.pendingExpenseMinor ?? 0)
  return (
    <dl className="budget-totals" aria-label="Budget totals">
      <div title={`Cleared ${formatMinorMoney(summary.clearedIncomeMinor ?? 0, currency)}`}>
        <dt>In</dt>
        <dd data-tone="income">+{formatMinorMoney(summary.totalIncomeMinor ?? 0, currency)}</dd>
      </div>
      <div title={`Cleared ${formatMinorMoney(summary.clearedExpenseMinor ?? 0, currency)}`}>
        <dt>Out</dt>
        <dd data-tone="expense">-{formatMinorMoney(summary.totalExpenseMinor ?? 0, currency)}</dd>
      </div>
      <div>
        <dt>Net</dt>
        <dd data-tone={net >= 0 ? 'income' : 'expense'}>
          {net >= 0 ? '+' : ''}
          {formatMinorMoney(net, currency)}
        </dd>
      </div>
      {pending > 0 && (
        <div>
          <dt>Pending</dt>
          <dd data-tone="pending">{formatMinorMoney(pending, currency)}</dd>
        </div>
      )}
    </dl>
  )
}

const NEXT_STATUS: Record<BudgetStatus, BudgetStatus> = {
  planned: 'pending',
  pending: 'cleared',
  cleared: 'planned',
  cancelled: 'planned',
}

/** The register's columns on the shared table; status cycles in place, ✕ deletes. */
function useBudgetColumns(update: ReturnType<typeof useUpdateBudgetItem>, remove: (ids: string[], name?: string) => Promise<void>, onChanged: () => void) {
  const changed = useRef(onChanged)
  changed.current = onChanged
  const { mutateAsync } = update
  const savingId = update.isPending ? update.variables?.budgetItemId : undefined
  return useMemo<Column<BudgetItem>[]>(() => {
    const cycle = async (item: BudgetItem) => {
      await mutateAsync({ budgetItemId: item.id, body: { status: NEXT_STATUS[item.status as BudgetStatus] } })
      changed.current()
    }
    const chip = (children: ReactNode, attrs: Record<string, string>) => <span className="budget-chip" {...attrs}>{children}</span>
    return [
      {
        id: 'title', header: 'Title', hideable: false, sortValue: (item) => item.title,
        title: (item) => (item.description ? `${item.title} — ${item.description}` : item.title),
        cell: (item) => <><span className="budget-title">{item.title}</span>{item.description && <span className="budget-note">{item.description}</span>}</>,
      },
      { id: 'date', header: 'Date', width: '104px', className: 'budget-date', sortValue: (item) => item.scheduledDate, cell: (item) => item.scheduledDate },
      {
        id: 'type', header: 'Type', width: '100px', sortValue: (item) => item.direction,
        cell: (item) => chip(item.direction === 'income' ? '↑ Income' : '↓ Expense', { 'data-direction': item.direction }),
      },
      {
        id: 'category', header: 'Category', width: '150px', sortValue: (item) => BUDGET_CATEGORIES[item.category as BudgetCategoryKey] ?? item.category,
        cell: (item) => chip(BUDGET_CATEGORIES[item.category as BudgetCategoryKey] ?? item.category, { 'data-kind': 'category' }),
      },
      {
        id: 'status', header: 'Status', width: '100px', sortValue: (item) => item.status,
        cell: (item) => (
          <button
            type="button"
            className="budget-chip budget-status"
            data-status={item.status}
            title="Click to cycle status: Planned → Pending → Cleared"
            disabled={savingId === item.id}
            onClick={() => void cycle(item)}
          >
            {BUDGET_STATUS_LABELS[item.status as BudgetStatus] ?? item.status}
          </button>
        ),
      },
      { id: 'contact', header: 'Contact', width: '150px', className: 'budget-contact', sortValue: (item) => item.contact?.displayName ?? null, cell: (item) => item.contact?.displayName ?? '—' },
      {
        id: 'amount', header: 'Amount', width: '130px', align: 'end', firstDir: -1,
        sortValue: (item) => (item.direction === 'income' ? item.amountMinor : -item.amountMinor),
        cell: (item) => (
          <span className="budget-amount" data-direction={item.direction}>
            {item.direction === 'income' ? '+' : '-'}
            {formatMinorMoney(item.amountMinor, item.currency)}
          </span>
        ),
      },
      deleteColumn<BudgetItem>({ name: (item) => item.title, onDelete: (item) => void remove([item.id], item.title) }),
    ]
  }, [mutateAsync, savingId, remove])
}

function NewBudgetItemSlideout({
  workspaceId,
  initialDirection,
  onClose,
  onCreated,
}: {
  workspaceId: string
  initialDirection: 'income' | 'expense'
  onClose: () => void
  onCreated: () => void
}) {
  const [direction, setDirection] = useState<'income' | 'expense'>(initialDirection)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amountDollars, setAmountDollars] = useState('')
  const [category, setCategory] = useState<string>(
    initialDirection === 'income' ? 'client_retainer' : 'software_tools',
  )
  const [status, setStatus] = useState<BudgetStatus>('planned')
  const [scheduledDate, setScheduledDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [contactId, setContactId] = useState('')

  const contactsQuery = useContacts(workspaceId)
  useEscape(onClose)
  const createMutation = useCreateBudgetItem(workspaceId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !amountDollars) return

    const dollars = parseFloat(amountDollars)
    if (isNaN(dollars) || dollars < 0) return

    const amountMinor = Math.round(dollars * 100)

    await createMutation.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      direction,
      category: category as BudgetCategory,
      amountMinor,
      scheduledDate,
      status,
      contactId: contactId || undefined,
    })

    onCreated()
  }

  const categoryOptions =
    direction === 'income'
      ? Object.entries(BUDGET_INCOME_CATEGORIES)
      : Object.entries(BUDGET_EXPENSE_CATEGORIES)

  return (
    <div className="budget-slideout-backdrop" onClick={onClose}>
      <div className="budget-slideout" role="dialog" aria-modal="true" aria-labelledby="budget-new-title" onClick={(e) => e.stopPropagation()}>
        <div className="budget-slideout-head">
          <h2 id="budget-new-title">New budget item</h2>
          <button type="button" className="budget-slideout-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className="budget-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="budget-form-fields">
          {/* Direction toggle */}
          <div className="budget-direction-selector">
            <button
              type="button"
              className="budget-dir-toggle"
              data-direction="income"
              aria-pressed={direction === 'income'}
              onClick={() => {
                setDirection('income')
                setCategory('client_retainer')
              }}
            >
              ↑ Income
            </button>
            <button
              type="button"
              className="budget-dir-toggle"
              data-direction="expense"
              aria-pressed={direction === 'expense'}
              onClick={() => {
                setDirection('expense')
                setCategory('software_tools')
              }}
            >
              ↓ Expense
            </button>
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-title">Title</label>
            <input
              id="budget-title"
              type="text"
              required
              placeholder={
                direction === 'income'
                  ? 'e.g. Monthly Retainer Acme Corp'
                  : 'e.g. Figma Team Subscription'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-amount">Amount (USD)</label>
            <input
              id="budget-amount"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
            />
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-category">Category</label>
            <select
              id="budget-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categoryOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-date">Scheduled Date (Calendar anchor)</label>
            <input
              id="budget-date"
              type="date"
              required
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-status">Status</label>
            <select
              id="budget-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as BudgetStatus)}
            >
              <option value="planned">Planned (Forecast / Blueprint assumption)</option>
              <option value="pending">Pending (Committed / Invoiced)</option>
              <option value="cleared">Cleared (Paid & settled)</option>
            </select>
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-contact">Associated Contact (Client / Vendor)</label>
            <select
              id="budget-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">None</option>
              {contactsQuery.data?.pages
                ?.flatMap((p) => p.data)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
            </select>
          </div>

          <div className="budget-form-field">
            <label htmlFor="budget-desc">Notes</label>
            <textarea
              id="budget-desc"
              rows={2}
              placeholder="Reference invoices, approval reasons, or details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          </div>

          <div className="budget-slideout-foot">
            <button type="button" className="budget-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="budget-submit"
              disabled={createMutation.isPending || !title.trim() || !amountDollars}
            >
              {createMutation.isPending ? 'Saving…' : '+ Add to Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Close on Escape, like the other side panels. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

function ImportBudgetSlideout({
  workspaceId,
  onClose,
  onImported,
}: {
  workspaceId: string
  onClose: () => void
  onImported: (count: number) => void
}) {
  const [tab, setTab] = useState<string>('starter')
  const [selectedSlug, setSelectedSlug] = useState<string>('lean-service-team')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // One key per file contents: a retry after a lost response replays instead of duplicating.
  const [key, setKey] = useState(() => crypto.randomUUID())
  const fileRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportBudgetItems(workspaceId)
  useEscape(onClose)

  const selectedBp = useMemo(() => blueprints.find((b) => b.slug === selectedSlug) ?? blueprints[0], [selectedSlug])
  const scenario = useMemo(() => scenarioData(selectedBp, '90'), [selectedBp])
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set(scenario.budget.map((_, i) => i)))

  // Sync selectedIndices when blueprint changes
  useEffect(() => {
    setSelectedIndices(new Set(scenario.budget.map((_, i) => i)))
  }, [scenario])

  const toggleIndex = (i: number) => {
    const next = new Set(selectedIndices)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setSelectedIndices(next)
  }

  const toggleAll = () => {
    if (selectedIndices.size === scenario.budget.length) {
      setSelectedIndices(new Set())
    } else {
      setSelectedIndices(new Set(scenario.budget.map((_, i) => i)))
    }
  }

  const chosenBudgetItems = scenario.budget.filter((_, i) => selectedIndices.has(i))

  const importPrefabBudget = async () => {
    if (chosenBudgetItems.length === 0) return
    setError('')
    try {
      const todayIso = new Date().toISOString().slice(0, 10)
      const items = chosenBudgetItems.map((b) => ({
        title: b.label,
        scheduledDate: todayIso,
        amountMinor: Math.round(Math.abs(b.amount) * 100),
        direction: b.direction,
        category: b.category,
        status: 'planned' as const,
        description: b.note || undefined,
      }))
      const importKey = `${workspaceId}:prefab:${selectedSlug}:${Date.now()}`
      const created = await importMutation.mutateAsync({ items, idempotencyKey: importKey })
      onImported(created.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Nothing was added.')
    }
  }

  const change = (value: string) => {
    setText(value)
    setError('')
    setKey(crypto.randomUUID())
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseBudgetCsv(text)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    try {
      const created = await importMutation.mutateAsync({ items: parsed.items, idempotencyKey: key })
      onImported(created.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. Nothing was added.')
    }
  }

  return (
    <FormSlideout
      title="Import Budget Items"
      width="680px"
      onClose={onClose}
    >
      <ImportModalTabs
        tabs={[
          { id: 'starter', label: 'Starter Packs' },
          { id: 'csv', label: 'CSV Upload' },
        ]}
        activeTab={tab}
        onSelectTab={setTab}
      />

      <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, overflowY: 'auto' }}>
        {tab === 'starter' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="prefab-pack-select-bar">
              <label htmlFor="budget-pack-select">Starter Model:</label>
              <select
                id="budget-pack-select"
                className="prefab-pack-select"
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
              >
                {blueprints.map((bp) => (
                  <option key={bp.slug} value={bp.slug}>
                    {bp.title} ({bp.type})
                  </option>
                ))}
              </select>
            </div>

            <p className="prefab-pack-meta">{selectedBp.description}</p>

            <div className="prefab-preview-table-wrap">
              <table className="prefab-preview-table" aria-label="Blueprint budget preview">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label="Select all records"
                        checked={scenario.budget.length > 0 && selectedIndices.size === scenario.budget.length}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Item Title</th>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.budget.map((item, idx) => {
                    const isChecked = selectedIndices.has(idx)
                    return (
                      <tr key={`${item.label}-${idx}`} onClick={() => toggleIndex(idx)} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleIndex(idx)}
                            aria-label={`Select ${item.label}`}
                          />
                        </td>
                        <td><strong>{item.label}</strong></td>
                        <td><span className="prefab-ref-tag">{BUDGET_CATEGORIES[item.category] || item.category}</span></td>
                        <td>
                          <span style={{ textTransform: 'capitalize', color: item.direction === 'income' ? '#34d399' : '#f87171' }}>
                            {item.direction}
                          </span>
                        </td>
                        <td>
                          <strong>{item.direction === 'income' ? `+$${item.amount.toLocaleString()}` : `-$${item.amount.toLocaleString()}`}</strong>
                        </td>
                        <td><span style={{ fontSize: '0.8rem', color: '#999' }}>{item.note}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {error && <p className="budget-error" role="alert">{error}</p>}

            <div className="prefab-actions-bar">
              <span className="prefab-count-note">
                {chosenBudgetItems.length} of {scenario.budget.length} items selected
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="cal-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="prefab-import-btn"
                  disabled={chosenBudgetItems.length === 0 || importMutation.isPending}
                  onClick={() => void importPrefabBudget()}
                >
                  {importMutation.isPending ? 'Importing…' : `Import Budget Items (${chosenBudgetItems.length})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'csv' && (
          <form className="budget-form" onSubmit={(e) => void submit(e)}>
            <div className="budget-form-fields">
              <div className="budget-form-field">
                <label htmlFor="budget-import-csv">CSV</label>
                <textarea
                  id="budget-import-csv"
                  rows={10}
                  spellCheck={false}
                  autoFocus
                  placeholder={'title,date,amount,type\nFigma,2026-11-03,75.00,expense'}
                  value={text}
                  onChange={(e) => change(e.target.value)}
                />
              </div>
              <CsvExample
                example={'title,date,amount,type,category,status,notes\nAcme retainer,2026-11-01,4500,income,Client Retainer,cleared,Invoice 1042\nFigma,2026-11-03,-75,,Tools & Software,,'}
                note="Required: title, date (YYYY-MM-DD or M/D/YYYY), amount. Optional: type (income or expense; otherwise a negative amount is an expense), category (name or key; unknown → Other), status (planned, pending, cleared, cancelled), notes. Up to 500 rows; one bad row stops the whole import."
              />
              {error && <p className="budget-error" role="alert">{error}</p>}
            </div>

            <div className="budget-slideout-foot">
              <button type="button" className="budget-cancel" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <button type="button" className="budget-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="budget-submit" disabled={importMutation.isPending || !text.trim()}>
                {importMutation.isPending ? 'Importing…' : 'Import'}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void file.text().then(change)
                e.target.value = ''
              }}
            />
          </form>
        )}

      </div>
    </FormSlideout>
  )
}


