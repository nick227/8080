import { useCreateWorkspace, useMyWorkspaces, useSession } from '@project/sdk'

// The workspace whose business data (contacts…) the Documents surface shows.
// One per person for now: the first active membership (a switcher can come later,
// doc/09 D15). Guests can't hold workspace data (D8) — they're asked to sign in.
export function useCurrentWorkspace() {
  const session = useSession()
  const me = session.data?.data
  const guest = me?.isGuest ?? true
  const workspaces = useMyWorkspaces()
  const create = useCreateWorkspace()
  return {
    workspace: workspaces.data?.[0] ?? null,
    loading: session.isLoading || workspaces.isLoading,
    guest,
    creating: create.isPending,
    createError: create.error ? (create.error as Error).message : null,
    create: () => create.mutate({ name: `${me?.displayName ?? 'My'}’s workspace` }),
  }
}
