import { useEffect, useMemo, useRef, useState } from 'react'
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
import { FilterChips } from '../collections/ColumnsMenu'
import '../documents/DocumentsList.css'
import { parseBudgetCsv } from './importParse'
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

  const items = budgetData?.data ?? []
  const totalCount = budgetData?.total ?? 0

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
        view={<BudgetTotals summary={summary} />}
        notice={notice ? <p className="collection-note" role="status">{notice}</p> : undefined}
      >
        <div className="docs-table-wrap collection-table-wrap" role="region" aria-label="Budget register" tabIndex={-1}>
          {isLoading ? (
            <p className="budget-empty">Loading budget records…</p>
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
            <table className="docs-table collection-table budget-table" aria-label="Budget register">
              <colgroup>
                <col className="budget-col-title" />
                <col className="budget-col-date" />
                <col className="budget-col-type" />
                <col className="budget-col-category" />
                <col className="budget-col-status" />
                <col className="budget-col-contact" />
                <col className="budget-col-amount" />
                <col className="budget-col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Contact</th>
                  <th scope="col" data-align="end">Amount</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <BudgetTableRow
                    key={item.id}
                    item={item}
                    workspaceId={workspaceId}
                    onChanged={() => void refetch()}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
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

function BudgetTableRow({
  item,
  workspaceId,
  onChanged,
}: {
  item: BudgetItem
  workspaceId: string
  onChanged: () => void
}) {
  const updateMutation = useUpdateBudgetItem(workspaceId)
  const deleteMutation = useDeleteBudgetItem(workspaceId)

  const isIncome = item.direction === 'income'
  const categoryLabel = BUDGET_CATEGORIES[item.category as BudgetCategoryKey] ?? item.category

  const handleNextStatus = async () => {
    const nextStatus: Record<BudgetStatus, BudgetStatus> = {
      planned: 'pending',
      pending: 'cleared',
      cleared: 'planned',
      cancelled: 'planned',
    }
    await updateMutation.mutateAsync({
      budgetItemId: item.id,
      body: { status: nextStatus[item.status as BudgetStatus] },
    })
    onChanged()
  }

  const handleDelete = async () => {
    if (confirm(`Delete "${item.title}"?`)) {
      await deleteMutation.mutateAsync(item.id)
      onChanged()
    }
  }

  return (
    <tr className="budget-row" data-row-id={item.id}>
      <td title={item.description ? `${item.title} — ${item.description}` : item.title}>
        <span className="budget-title">{item.title}</span>
        {item.description && <span className="budget-note">{item.description}</span>}
      </td>
      <td className="budget-date" data-label="Date">{item.scheduledDate}</td>
      <td data-label="Type">
        <span className="budget-chip" data-direction={item.direction}>
          {isIncome ? '↑ Income' : '↓ Expense'}
        </span>
      </td>
      <td data-label="Category">
        <span className="budget-chip" data-kind="category">{categoryLabel}</span>
      </td>
      <td data-label="Status">
        <button
          type="button"
          className="budget-chip budget-status"
          data-status={item.status}
          title="Click to cycle status: Planned → Pending → Cleared"
          disabled={updateMutation.isPending}
          onClick={() => void handleNextStatus()}
        >
          {BUDGET_STATUS_LABELS[item.status as BudgetStatus] ?? item.status}
        </button>
      </td>
      <td className="budget-contact" data-label="Contact" data-empty={item.contact ? undefined : ''}>
        {item.contact?.displayName ?? '—'}
      </td>
      <td data-label="Amount" data-align="end">
        <span className="budget-amount" data-direction={item.direction}>
          {isIncome ? '+' : '-'}
          {formatMinorMoney(item.amountMinor, item.currency)}
        </span>
      </td>
      <td data-align="end">
        <button
          type="button"
          className="collection-row-action budget-delete"
          onClick={() => void handleDelete()}
          aria-label={`Delete ${item.title}`}
          title="Delete"
        >
          ✕
        </button>
      </td>
    </tr>
  )
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
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // One key per file contents: a retry after a lost response replays instead of duplicating.
  const [key, setKey] = useState(() => crypto.randomUUID())
  const fileRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportBudgetItems(workspaceId)
  useEscape(onClose)

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
    <div className="budget-slideout-backdrop" onClick={onClose}>
      <div className="budget-slideout" role="dialog" aria-modal="true" aria-labelledby="budget-import-title" onClick={(e) => e.stopPropagation()}>
        <div className="budget-slideout-head">
          <h2 id="budget-import-title">Import budget items</h2>
          <button type="button" className="budget-slideout-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

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
      </div>
    </div>
  )
}
