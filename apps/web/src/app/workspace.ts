import { useParams } from 'react-router-dom'
import { create } from 'zustand'
import { useCreateWorkspace, useMyWorkspaces, useRoomCompany, useSession } from '@project/sdk'

// The one place that decides which company (workspace) the app is showing
// (docs/8080-redesign-proposal/00-decisions.md, D1). Order: the `:workspaceId`
// route param, then (on a room page) the company the room is listed under, then
// the workspace this browser last chose, then the first membership. A remembered id that isn't a current membership is ignored. Guests never
// hold workspace data (doc/09 D8): the server returns no memberships, so they resolve to null.

const KEY = '8080.workspace'

function load(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

const useChosen = create<{ id: string | null }>(() => ({ id: load() }))

/** The remembered company id, for stores outside React (they can't read the route). */
export function rememberedWorkspace(): string | null {
  return useChosen.getState().id
}

/** Remember a company as this browser's current one (the future switcher calls this). */
export function chooseWorkspace(id: string) {
  useChosen.setState({ id })
  try { localStorage.setItem(KEY, id) } catch { /* still applies for this visit */ }
}

export function useCurrentWorkspace() {
  const session = useSession()
  const guest = session.data?.data.isGuest ?? true
  const workspaces = useMyWorkspaces()
  const params = useParams()
  const routed = params.workspaceId
  // On a room page, the company the room is listed under (named only to its members).
  const roomCompanyQuery = useRoomCompany(params.roomId)
  const roomCompany = roomCompanyQuery.data?.id ?? null
  const chosen = useChosen((s) => s.id)
  // Memberships come from the server; guests simply have none (doc/09 D8).
  const list = workspaces.data ?? []
  // On a room page, wait for the room's company too, or a redirect could pick the wrong one.
  const loading = session.isLoading || workspaces.isLoading || (Boolean(params.roomId) && roomCompanyQuery.isLoading)
  // A routed company you don't belong to is "missing": never show another one under its URL.
  const missing = Boolean(routed) && !loading && !list.some((w) => w.id === routed)
  const workspace = missing ? null
    : list.find((w) => w.id === routed)
      ?? list.find((w) => w.id === roomCompany)
      ?? list.find((w) => w.id === chosen)
      ?? list[0]
      ?? null
  return { workspace, loading, guest, missing }
}

/** For the "create your company" empty states only (one mutation per screen, not per consumer). */
export function useCreateCompany() {
  const me = useSession().data?.data
  const creator = useCreateWorkspace()
  return {
    creating: creator.isPending,
    createError: creator.error ? (creator.error as Error).message : null,
    create: () => creator.mutate({ name: `${me?.displayName ?? 'My'}’s company` }),
  }
}
