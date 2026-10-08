import { companyInsightsService } from '../services/CompanyInsightsService'
import { pipelineService } from '../services/PipelineService'
import { vocabularyService } from '../services/VocabularyService'
import { workspaceCtx } from '../lib/session'

export async function getWorkspaceInsights(request: any, reply: any) {
  return reply.send({ data: await companyInsightsService.get(request.user.id, request.params.workspaceId) })
}

export async function getWorkspaceVocabulary(request: any, reply: any) {
  return reply.send({ data: await vocabularyService.get(request.user.id, request.params.workspaceId) })
}

export async function updateWorkspacePipeline(request: any, reply: any) {
  return reply.send({ data: await pipelineService.update(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function createInventoryCategory(request: any, reply: any) {
  return reply.status(201).send({ data: await vocabularyService.createCategory(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function renameInventoryCategory(request: any, reply: any) {
  return reply.send({ data: await vocabularyService.renameCategory(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function deleteInventoryCategory(request: any, reply: any) {
  return reply.send({ data: await vocabularyService.removeCategory(workspaceCtx(request), request.params.workspaceId, request.body) })
}

export async function updateContactFieldLabels(request: any, reply: any) {
  return reply.send({ data: await vocabularyService.updateFields(workspaceCtx(request), request.params.workspaceId, request.body) })
}
