import { useEffect, useState } from 'react'
import { CONTACT_FIELD_DEFAULTS, CONTACT_MILESTONES, CONTACT_SORTS, type ContactFieldDefinition, type ContactSort } from '@project/shared'

export const BASE_COLUMNS = ['stage', 'owner', 'lastContactedAt', 'notes', ...CONTACT_MILESTONES]
const coreColumns = [
  { key: 'stage', label: 'Current stage', sort: 'stage', position: 20 },
  { key: 'owner', label: 'Owner', sort: 'owner', position: 40 },
  { key: 'notes', label: 'Notes', position: 75 },
  { key: 'company', label: 'Company', sort: 'company', position: 90 },
  { key: 'details', label: 'Email / phone', position: 100 },
  { key: 'leadSource', label: 'Lead source', position: 140 },
]
export function columnsFor(fields: ContactFieldDefinition[]) {
  return [...coreColumns, ...fields.filter(f => !f.archived).map(f => ({
    key: f.key, label: f.label, position: f.position,
    sort: f.key === 'lastContactedAt' ? 'lastContacted' : CONTACT_SORTS.includes(f.key as ContactSort) ? f.key : undefined,
  }))].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
}
export function readContactPreference<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
export function saveContactPreference(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Visit-local state remains usable. */ }
}
export function useContactColumns(preferenceKey: string) {
  const read = () => {
    const saved = readContactPreference<unknown>(`${preferenceKey}:columns:v2`, BASE_COLUMNS)
    return Array.isArray(saved) && saved.every(c => typeof c === 'string') ? saved : BASE_COLUMNS
  }
  const [columns, setColumns] = useState<string[]>(read)
  useEffect(() => { setColumns(read()) }, [preferenceKey])
  return [columns, (next: string[]) => { setColumns(next); saveContactPreference(`${preferenceKey}:columns:v2`, next) }] as const
}
export function sortLabel(key: string, fields = CONTACT_FIELD_DEFAULTS) {
  return ({ name: 'Name', company: 'Company', owner: 'Owner', stage: 'Current stage', followUp: 'Follow-up', lastContacted: 'Last contacted', updated: 'Updated', activity: 'Activity' } as Record<string, string>)[key] ?? fields.find(f => f.key === key)?.label ?? key
}
export function followUpDay(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const followUpInstant = (day: string) => day ? new Date(`${day}T09:00:00`).toISOString() : null
