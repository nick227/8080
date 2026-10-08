import type { Desk } from '../work/sections'

export type DeskLink = { desk: string; params?: Record<string, string> }

export function applyDeskLink(
  link: DeskLink,
  select: (desk: Desk) => void,
  navigateSearch: (params: URLSearchParams) => void,
) {
  const params = new URLSearchParams()
  params.set('desk', link.desk)
  for (const [key, value] of Object.entries(link.params ?? {})) {
    if (value) params.set(key, value)
  }
  navigateSearch(params)
  if (link.desk !== 'company') select(link.desk as Desk)
}
