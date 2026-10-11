import { useState, useMemo } from 'react'
import {
  useBudgetItems,
  useBudgetSummary,
  useCreateBudgetItem,
  useUpdateBudgetItem,
  useDeleteBudgetItem,
  useContacts,
  type BudgetItem,
  type BudgetDirection,
  type BudgetStatus,
  type BudgetCategory,
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
import { CollectionView } from '../collections/CollectionView'
import './budget.css'

export function BudgetTable({ workspaceId }: { workspaceId: string }) {
  const [activeTab, setActiveTab] = useState<'all' | 'income' | 'expense'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [isSlideoutOpen, setIsSlideoutOpen] = useState(false)

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
      {/* Top Aggregate KPI Strip */}
      <BudgetKPIBar summary={summary} />

      {/* Collection Tabular View */}
      <CollectionView
        collection="budget"
        count={totalCount}
        onNew={() => setIsSlideoutOpen(true)}
        subtitle="Manage expenditures and incomes affecting aggregate cashflow and scheduled calendars."
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search budget descriptions and notes…',
        }}
        filters={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Segmented Direction Tabs */}
            <div className="budget-tabs" role="tablist" aria-label="Budget type tabs">
              <button
                type="button"
                className={`budget-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('all')
                  setCategoryFilter('all')
                }}
              >
                All Entries
              </button>
              <button
                type="button"
                className={`budget-tab-btn ${activeTab === 'income' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('income')
                  setCategoryFilter('all')
                }}
              >
                Income
              </button>
              <button
                type="button"
                className={`budget-tab-btn ${activeTab === 'expense' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('expense')
                  setCategoryFilter('all')
                }}
              >
                Expenses
              </button>
            </div>

            {/* Category Filter */}
            <select
              className="budget-filter-select"
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

            {/* Status Filter */}
            <select
              className="budget-filter-select"
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
          </div>
        }
      >
        <div className="budget-table-wrap">
          {isLoading ? (
            <p className="budget-empty">Loading budget records…</p>
          ) : items.length === 0 ? (
            <div className="budget-empty">
              <h3>No budget items found</h3>
              <p>Add planned income or expense allowances to track aggregate totals and calendar dates.</p>
              <button
                type="button"
                className="section-add-btn"
                style={{ marginTop: '12px' }}
                onClick={() => setIsSlideoutOpen(true)}
              >
                + Add budget entry
              </button>
            </div>
          ) : (
            <table className="budget-table" aria-label="Budget Register">
              <thead>
                <tr>
                  <th>Scheduled Date</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Contact</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
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

      {/* Slideout for Creating New Budget Items */}
      {isSlideoutOpen && (
        <NewBudgetItemSlideout
          workspaceId={workspaceId}
          initialDirection={activeTab === 'expense' ? 'expense' : 'income'}
          onClose={() => setIsSlideoutOpen(false)}
          onCreated={() => {
            setIsSlideoutOpen(false)
            void refetch()
          }}
        />
      )}
    </div>
  )
}

function BudgetKPIBar({ summary }: { summary?: any }) {
  const currency = summary?.currency ?? 'USD'
  const incomeTotal = summary?.totalIncomeMinor ?? 0
  const expenseTotal = summary?.totalExpenseMinor ?? 0
  const netTotal = summary?.netBalanceMinor ?? 0
  const pendingCount = (summary?.pendingIncomeMinor ? 1 : 0) + (summary?.pendingExpenseMinor ? 1 : 0)

  return (
    <div className="budget-kpi-grid" aria-label="Budget aggregates">
      <div className="budget-kpi-card">
        <span className="budget-kpi-label">Total Inflow (Income)</span>
        <span className="budget-kpi-value inflow">
          +{formatMinorMoney(incomeTotal, currency)}
        </span>
        <span className="budget-kpi-sub">
          Cleared: {formatMinorMoney(summary?.clearedIncomeMinor ?? 0, currency)}
        </span>
      </div>

      <div className="budget-kpi-card">
        <span className="budget-kpi-label">Total Outflow (Expenses)</span>
        <span className="budget-kpi-value outflow">
          -{formatMinorMoney(expenseTotal, currency)}
        </span>
        <span className="budget-kpi-sub">
          Cleared: {formatMinorMoney(summary?.clearedExpenseMinor ?? 0, currency)}
        </span>
      </div>

      <div className="budget-kpi-card">
        <span className="budget-kpi-label">Net Cashflow / Margin</span>
        <span className={`budget-kpi-value ${netTotal >= 0 ? 'positive' : 'negative'}`}>
          {netTotal >= 0 ? '+' : ''}
          {formatMinorMoney(netTotal, currency)}
        </span>
        <span className="budget-kpi-sub">
          {netTotal >= 0 ? 'Positive Operating Margin' : 'Net Cash Burn'}
        </span>
      </div>

      <div className="budget-kpi-card">
        <span className="budget-kpi-label">Pending Settlements</span>
        <span className="budget-kpi-value" style={{ color: '#d97706' }}>
          {formatMinorMoney((summary?.pendingIncomeMinor ?? 0) + (summary?.pendingExpenseMinor ?? 0), currency)}
        </span>
        <span className="budget-kpi-sub">
          {summary?.itemCount ?? 0} total entries tracked
        </span>
      </div>
    </div>
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
    <tr className="budget-row">
      <td className="budget-date">{item.scheduledDate}</td>
      <td>
        <strong>{item.title}</strong>
        {item.description && (
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
            {item.description}
          </div>
        )}
      </td>
      <td>
        <span className={`budget-direction-chip ${isIncome ? 'income' : 'expense'}`}>
          {isIncome ? '↑ Income' : '↓ Expense'}
        </span>
      </td>
      <td>
        <span className="budget-category-label">{categoryLabel}</span>
      </td>
      <td>
        <button
          type="button"
          className={`budget-badge ${item.status}`}
          title="Click to cycle status: Planned → Pending → Cleared"
          onClick={() => void handleNextStatus()}
          style={{ cursor: 'pointer', borderStyle: 'solid' }}
        >
          {BUDGET_STATUS_LABELS[item.status as BudgetStatus] ?? item.status}
        </button>
      </td>
      <td className="budget-contact">
        {item.contact?.displayName ?? '—'}
      </td>
      <td style={{ textAlign: 'right' }}>
        <span className={`budget-amount ${isIncome ? 'income' : 'expense'}`}>
          {isIncome ? '+' : '-'}
          {formatMinorMoney(item.amountMinor, item.currency)}
        </span>
      </td>
      <td className="budget-actions-cell">
        <button
          type="button"
          className="budget-action-btn delete"
          onClick={() => void handleDelete()}
          aria-label={`Delete ${item.title}`}
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
      <div className="budget-slideout" onClick={(e) => e.stopPropagation()}>
        <div className="budget-slideout-head">
          <h2>New Budget Line Item</h2>
          <button type="button" className="budget-slideout-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="budget-form" onSubmit={(e) => void handleSubmit(e)}>
          {/* Direction toggle */}
          <div className="budget-direction-selector">
            <button
              type="button"
              className={`budget-dir-toggle ${direction === 'income' ? 'active income' : ''}`}
              onClick={() => {
                setDirection('income')
                setCategory('client_retainer')
              }}
            >
              ↑ Income
            </button>
            <button
              type="button"
              className={`budget-dir-toggle ${direction === 'expense' ? 'active expense' : ''}`}
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

          <div className="budget-slideout-foot">
            <button type="button" className="budget-action-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="section-add-btn"
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
