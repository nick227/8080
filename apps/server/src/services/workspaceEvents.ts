// Live fan-out of recorded workspace activity (one process, like inboxHub). The
// board's real-time updates will subscribe here; nothing does yet besides tests.
export type WorkspaceEvent = { activityId: string; type: string; taskId: string | null; actorMemberId: string | null; occurredAt: string }

type Send = (event: WorkspaceEvent) => void

const subscribers = new Map<string, Set<Send>>()

export function publishWorkspace(workspaceId: string, event: WorkspaceEvent) {
  for (const send of subscribers.get(workspaceId) ?? []) send(event)
}

export function subscribeWorkspace(workspaceId: string, send: Send) {
  let set = subscribers.get(workspaceId)
  if (!set) subscribers.set(workspaceId, (set = new Set()))
  set.add(send)
  return () => {
    set.delete(send)
    if (!set.size) subscribers.delete(workspaceId)
  }
}
