import { LEGACY_LEAD_STATUSES } from '@project/shared'
import type { Contact, InventoryItem, LeadStatus } from '@project/sdk'

/** Fallback stage keys before vocabulary loads. */
export const STAGES: LeadStatus[] = [...LEGACY_LEAD_STATUSES]

export const titleCase = (value: string) =>
  value.includes('_') || value === value.toLowerCase()
    ? value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : value.charAt(0).toUpperCase() + value.slice(1)

export const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not set'

export const localDay = (value: string | null) => {
  if (!value) return ''
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const priceLabel = (value: number, currency = 'USD') =>
  value.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const stockLabel = (item: InventoryItem) =>
  item.quantity === null
    ? 'Stock not tracked'
    : item.quantity === 0
      ? 'Out of stock'
      : item.lowStock
        ? `${item.quantity} in stock · Low`
        : `${item.quantity} in stock`

export const contactSubtitle = (contact: Contact) =>
  contact.accounts.find((account) => account.isPrimary)?.name ??
  contact.accounts[0]?.name ??
  contact.primaryEmail ??
  contact.title ??
  'Contact'

export const followUpLate = (contact: Contact) =>
  !contact.won &&
  !!contact.nextFollowUp &&
  localDay(contact.nextFollowUp) < localDay(new Date().toISOString()) &&
  contact.leadStatus !== 'customer' &&
  contact.leadStatus !== 'lost'
