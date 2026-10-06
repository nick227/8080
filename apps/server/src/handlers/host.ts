// chatbot as workspace host + the company profile (doc/12).
import { workspaceHost } from '../services/WorkspaceHost'
import { CompanyProfileService } from '../services/CompanyProfileService'

const profiles = new CompanyProfileService()

export async function openWorkspaceChannel(request: any, reply: any) {
  return reply.send({ data: await workspaceHost.open(request.user.id, request.params.workspaceId) })
}

export async function getCompanyProfile(request: any, reply: any) {
  return reply.send({ data: await profiles.get(request.user.id, request.params.workspaceId) })
}
