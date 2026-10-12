import type { PrefabContact, PrefabInventory, PrefabTask } from '@project/shared'

function escapeCsvCell(value: string | number | undefined | null): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export function contactsToCsv(contacts: PrefabContact[]): string {
  const headers = ['firstName', 'lastName', 'displayName', 'title', 'email', 'phone', 'accountName', 'location']
  const rows = contacts.map((c) => [
    escapeCsvCell(c.firstName),
    escapeCsvCell(c.lastName),
    escapeCsvCell(c.displayName),
    escapeCsvCell(c.title),
    escapeCsvCell(c.email),
    escapeCsvCell(c.phone),
    escapeCsvCell(c.accountName),
    escapeCsvCell(c.location ?? ''),
  ].join(','))
  return [headers.join(','), ...rows].join('\n')
}

export function inventoryToCsv(items: PrefabInventory[]): string {
  const headers = ['name', 'sku', 'description', 'price', 'category', 'quantity', 'availability']
  const rows = items.map((i) => [
    escapeCsvCell(i.name),
    escapeCsvCell(i.sku),
    escapeCsvCell(i.description),
    escapeCsvCell(i.price),
    escapeCsvCell(i.category),
    escapeCsvCell(i.quantity),
    escapeCsvCell(i.availability),
  ].join(','))
  return [headers.join(','), ...rows].join('\n')
}

export function tasksToCsv(tasks: PrefabTask[], targetDate: string = new Date().toISOString().slice(0, 10)): string {
  const headers = ['title', 'date', 'time', 'status']
  const rows = tasks.map((t) => [
    escapeCsvCell(t.title),
    escapeCsvCell(targetDate),
    escapeCsvCell('09:00 AM'),
    escapeCsvCell('open'),
  ].join(','))
  return [headers.join(','), ...rows].join('\n')
}
