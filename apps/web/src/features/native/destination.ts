// Where a notice opens. /native/ has no task or document views of its own, so
// these deep-link into the existing web routes (same session, same permissions).
import { ApiError, getApiClient, unwrap, type InboxItem } from '@project/sdk'

export type Destination = { path: string } | { gone: string }

export async function destinationOf(item: InboxItem): Promise<Destination> {
  const ws = `/c/${item.workspaceId}`
  switch (item.sourceType) {
    case 'task': {
      // Notices carry the task id; task pages are addressed by key.
      try {
        const { data } = unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tasks/{taskId}', { params: { path: { workspaceId: item.workspaceId, taskId: item.sourceId } } }))
        return { path: `${ws}/tasks/${encodeURIComponent(data.taskKey)}` }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return { gone: 'That task was deleted or you no longer have access.' }
        throw err
      }
    }
    case 'conversation': return { path: `/room/${item.sourceId}` }
    case 'contact': return { path: `${ws}/contacts?record=${encodeURIComponent(item.action.contactId ?? item.sourceId)}` }
    case 'document': return { path: `${ws}/documents` }
    case 'calendar': return { path: `${ws}/calendar` }
    case 'agentEvent': return { path: `${ws}/agents` }
    default: return { path: ws }
  }
}
