// Where a notice opens. /native/ has no task or document views of its own, so
// these deep-link into the existing web routes (same session, same permissions).
import { ApiError, getApiClient, unwrap } from '@project/sdk'
import type { Notice } from './inbox'

export type Destination = { path: string } | { gone: string }

export async function destinationOf(notice: Notice): Promise<Destination> {
  if (notice.sourceType === 'conversation') return { path: `/room/${notice.sourceId}` }
  if (!notice.workspaceId) return { path: '/native/' }
  const ws = `/c/${notice.workspaceId}`
  switch (notice.sourceType) {
    case 'task': {
      // Notices carry the task id; task pages are addressed by key.
      try {
        const { data } = unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/{taskId}', { params: { path: { workspaceId: notice.workspaceId, taskId: notice.sourceId } } }))
        return { path: `${ws}/tasks/${encodeURIComponent(data.taskKey)}` }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return { gone: 'That task was deleted or you no longer have access.' }
        throw err
      }
    }
    case 'contact': return { path: `${ws}/contacts?record=${encodeURIComponent(notice.contactId ?? notice.sourceId)}` }
    case 'document': return { path: `${ws}/documents` }
    case 'calendar': return { path: `${ws}/calendar` }
    case 'agentEvent': return { path: `${ws}/agents` }
    default: return { path: ws }
  }
}
