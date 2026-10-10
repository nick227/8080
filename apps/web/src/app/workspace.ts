import { useParams } from 'react-router-dom'
import { create } from 'zustand'
import { useCreateWorkspace, useMyWorkspaces, useSession } from '@project/sdk'

// The one place that decides which company (workspace) the app is showing
// (docs/8080-redesign-proposal/00-decisions.md, D1). Order: the `:workspaceId`
// route param, then the workspace this browser last chose, then the first
// membership. Anything that isn't a current membership is ignored. Guests never
// hold workspace data (doc/09 D8), so they always resolve to null.

const KEY = '8080.workspace'

function load(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

const useChosen = create<{ id: string | null }>(() => ({ id: load() }))

/** Remember a company as this browser's current one (the future switcher calls this). */
export function chooseWorkspace(id: string) {
  useChosen.setState({ id })
  try { localStorage.setItem(KEY, id) } catch { /* still applies for this visit */ }
}

export function useCurrentWorkspace() {
  const session = useSession()
  const me = session.data?.data
  const guest = me?.isGuest ?? true
  const workspaces = useMyWorkspaces()
  const creator = useCreateWorkspace()
  const routed = useParams().workspaceId
  const chosen = useChosen((s) => s.id)
  const list = guest ? [] : workspaces.data ?? []
  const workspace = list.find((w) => w.id === routed)
    ?? list.find((w) => w.id === chosen)
    ?? list[0]
    ?? null
  return {
    workspace,
    loading: session.isLoading || (!guest && workspaces.isLoading),
    guest,
    creating: creator.isPending,
    createError: creator.error ? (creator.error as Error).message : null,
    create: () => creator.mutate({ name: `${me?.displayName ?? 'My'}’s workspace` }),
  }
}
