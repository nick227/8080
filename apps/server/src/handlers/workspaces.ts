import { WorkspaceService } from '../services/WorkspaceService'
import { TeamService } from '../services/TeamService'
import { workspaceCtx as ctx } from '../lib/session'

const workspaceService = new WorkspaceService()
const teamService = new TeamService()


// ─── workspaces ──────────────────────────────────────────────────────────────

export async function createWorkspace(request: any, reply: any) {
  return reply.status(201).send({ data: await workspaceService.create(ctx(request), request.body) })
}

export async function listMyWorkspaces(request: any, reply: any) {
  return reply.send({ data: await workspaceService.listMine(request.user.id) })
}

export async function getWorkspace(request: any, reply: any) {
  return reply.send({ data: await workspaceService.get(request.user.id, request.params.workspaceId) })
}

export async function updateWorkspace(request: any, reply: any) {
  return reply.send({ data: await workspaceService.update(ctx(request), request.params.workspaceId, request.body) })
}

export async function deleteWorkspace(request: any, reply: any) {
  await workspaceService.remove(ctx(request), request.params.workspaceId)
  return reply.send({ data: null })
}

// ─── members and invites ─────────────────────────────────────────────────────

export async function listWorkspaceMembers(request: any, reply: any) {
  const members = await workspaceService.listMembers(request.user.id, request.params.workspaceId, { includeRemoved: request.query.includeRemoved })
  return reply.send({ data: members })
}

export async function updateWorkspaceMember(request: any, reply: any) {
  const { workspaceId, memberId } = request.params
  return reply.send({ data: await workspaceService.updateMember(ctx(request), workspaceId, memberId, request.body) })
}

export async function removeWorkspaceMember(request: any, reply: any) {
  await workspaceService.removeMember(ctx(request), request.params.workspaceId, request.params.memberId)
  return reply.send({ data: null })
}

export async function createWorkspaceInvite(request: any, reply: any) {
  return reply.status(201).send(await workspaceService.createInvite(ctx(request), request.params.workspaceId, request.body))
}

export async function listWorkspaceInvites(request: any, reply: any) {
  return reply.send({ data: await workspaceService.listInvites(request.user.id, request.params.workspaceId) })
}

export async function revokeWorkspaceInvite(request: any, reply: any) {
  await workspaceService.revokeInvite(ctx(request), request.params.workspaceId, request.params.inviteId)
  return reply.send({ data: null })
}

export async function previewWorkspaceInvite(request: any, reply: any) {
  return reply.send({ data: await workspaceService.previewInvite(request.body.token) })
}

export async function acceptWorkspaceInvite(request: any, reply: any) {
  return reply.send({ data: await workspaceService.acceptInvite(ctx(request), request.body.token) })
}

// ─── teams ───────────────────────────────────────────────────────────────────

export async function listTeams(request: any, reply: any) {
  return reply.send({ data: await teamService.list(request.user.id, request.params.workspaceId, { includeArchived: request.query.includeArchived }) })
}

export async function createTeam(request: any, reply: any) {
  const team = await teamService.create(ctx(request), request.params.workspaceId, request.body, request.headers['idempotency-key'])
  return reply.status(201).send({ data: team })
}

export async function updateTeam(request: any, reply: any) {
  const { workspaceId, teamId } = request.params
  return reply.send({ data: await teamService.update(ctx(request), workspaceId, teamId, request.body) })
}

export async function setTeamMember(request: any, reply: any) {
  const { workspaceId, teamId, memberId } = request.params
  return reply.send({ data: await teamService.setMember(ctx(request), workspaceId, teamId, memberId, request.body ?? {}) })
}

export async function removeTeamMember(request: any, reply: any) {
  const { workspaceId, teamId, memberId } = request.params
  return reply.send({ data: await teamService.removeMember(ctx(request), workspaceId, teamId, memberId) })
}

// ─── timeline and audit ──────────────────────────────────────────────────────

export async function listWorkspaceActivity(request: any, reply: any) {
  return reply.send(await workspaceService.listActivity(request.user.id, request.params.workspaceId, request.query))
}

export async function listWorkspaceActions(request: any, reply: any) {
  return reply.send(await workspaceService.listActions(request.user.id, request.params.workspaceId, request.query))
}
