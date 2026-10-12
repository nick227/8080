import { forbidden } from '../../lib/errors'
import { authorize as workspaceAuthorize, type WorkspaceVerb, type PolicyTarget } from '../workspacePolicy'
import { authorizePlatform, type PlatformPermission } from './platform'

// Discriminated scope prevents using a workspace permission for a platform call.
export type AuthorizationRequest =
  | { scope: 'platform'; permission: PlatformPermission }
  | { scope: 'workspace'; workspaceId: string; permission: WorkspaceVerb; resource?: PolicyTarget }

export function authorize(userId: string, request: AuthorizationRequest) {
  if (request.scope !== 'platform' && request.scope !== 'workspace') throw forbidden('Unknown authorization scope')
  return request.scope === 'platform'
    ? authorizePlatform(userId, request.permission)
    : workspaceAuthorize(userId, request.workspaceId, request.permission, request.resource)
}
