// The one place recorded activity fans out (doc/09 §3 Activity rows are the
// durable events). Runs inside the action's transaction: consumers write what
// must be atomic with the change (notifications) and return effects to run after
// the commit (live pushes). History and reports read the same rows.
import type { Activity, Prisma } from '@project/db'
import { notifyTaskActivity } from './taskNotices'
import { publishWorkspace } from './workspaceEvents'

type Tx = Prisma.TransactionClient

export type AfterCommit = () => void

type Consumer = (tx: Tx, activities: Activity[]) => Promise<AfterCommit[]>

const CONSUMERS: Consumer[] = [notifyTaskActivity]

export async function deliverActivities(tx: Tx, activities: Activity[]): Promise<AfterCommit[]> {
  const effects: AfterCommit[] = []
  for (const consume of CONSUMERS) effects.push(...(await consume(tx, activities)))
  effects.push(() => {
    for (const a of activities) {
      publishWorkspace(a.workspaceId, { activityId: a.id, type: a.type, taskId: a.taskId, actorMemberId: a.actorMemberId, occurredAt: a.occurredAt.toISOString() })
    }
  })
  return effects
}
