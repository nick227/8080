export type BudgetDirectionKey = 'income' | 'expense'

export type BudgetStatusKey = 'planned' | 'pending' | 'cleared' | 'cancelled'

export type BudgetRecurrenceKey = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

export type BudgetIncomeCategoryKey =
  | 'client_retainer'
  | 'project_fee'
  | 'product_sales'
  | 'consulting'
  | 'grant_investment'
  | 'other_income'

export type BudgetExpenseCategoryKey =
  | 'software_tools'
  | 'materials_cogs'
  | 'contractor_support'
  | 'payroll_wages'
  | 'facilities_rent'
  | 'marketing_ads'
  | 'travel_hospitality'
  | 'legal_admin'
  | 'taxes_fees'
  | 'other_expense'

export type BudgetCategoryKey = BudgetIncomeCategoryKey | BudgetExpenseCategoryKey

export const BUDGET_INCOME_CATEGORIES: Record<BudgetIncomeCategoryKey, string> = {
  client_retainer: 'Client Retainer',
  project_fee: 'Project Fee',
  product_sales: 'Product Sales',
  consulting: 'Consulting & Advisory',
  grant_investment: 'Grant & Investment',
  other_income: 'Other Income',
}

export const BUDGET_EXPENSE_CATEGORIES: Record<BudgetExpenseCategoryKey, string> = {
  software_tools: 'Tools & Software',
  materials_cogs: 'Materials & Setup',
  contractor_support: 'Outside Support',
  payroll_wages: 'Payroll & Compensation',
  facilities_rent: 'Facilities & Rent',
  marketing_ads: 'Marketing & Ads',
  travel_hospitality: 'Travel & Hospitality',
  legal_admin: 'Legal & Admin',
  taxes_fees: 'Taxes & Fees',
  other_expense: 'Other Expense',
}

export const BUDGET_CATEGORIES: Record<BudgetCategoryKey, string> = {
  ...BUDGET_INCOME_CATEGORIES,
  ...BUDGET_EXPENSE_CATEGORIES,
}

export const BUDGET_STATUS_LABELS: Record<BudgetStatusKey, string> = {
  planned: 'Planned',
  pending: 'Pending',
  cleared: 'Cleared',
  cancelled: 'Cancelled',
}

export const BUDGET_RECURRENCE_LABELS: Record<BudgetRecurrenceKey, string> = {
  none: 'One-time',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
}

export function formatMinorMoney(amountMinor: number, currency = 'USD'): string {
  const isNegative = amountMinor < 0
  const absDollars = Math.abs(amountMinor) / 100
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absDollars)
    return isNegative ? `-${formatted}` : formatted
  } catch {
    return `${isNegative ? '-' : ''}${currency} ${absDollars.toFixed(2)}`
  }
}
