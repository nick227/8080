// Slice 0 of doc/09: workspaces, membership, invites, teams, audit, timeline and
// the policy module. Alice (registered) owns; Bob (guest) is the outsider; Carol
// and Dave are registered accounts created here.
import { describe, it, expect } from 'vitest'
import { db } from '@project/db'
import { load } from 'js-yaml'
import { readFileSync } from 'fs'
import { buildTestApp, asAuth, validateResponse, testUserId, testOtherUserId, multipart } from './helpers'
import { specPath } from '../app'
import { can, type WorkspaceVerb } from '../services/workspacePolicy'
import { crossWorkspaceViolations } from '../services/workspaceIntegrity'
import { caller, carolId, createWorkspace as createWs, daveId, join as joinWs, memberId, seedPeople } from './helpers/workspace'

const app = buildTestApp()

const call = caller(app)
const createWorkspace = (ownerId = testUserId, body: object = { name: 'Acme Co' }) => createWs(app, ownerId, body)
const join = (workspaceId: string, userId: string, email: string, role: 'admin' | 'member' = 'member') => joinWs(app, workspaceId, userId, email, role)

const executions = (workspaceId: string, action: string) => db.actionExecution.findMany({ where: { workspaceId, action }, orderBy: { requestedAt: 'asc' } })

describe('createWorkspace', () => {
  it('makes the caller owner, derives a free slug, and records action + activity', async () => {
    const res = await call(testUserId, 'POST', '/workspaces', { name: 'Acme Co', timezone: 'America/New_York' })
    expect(res.statusCode).toBe(201)
    await validateResponse('createWorkspace', 201, res.json())
    const ws = res.json().data
    expect(ws).toMatchObject({ name: 'Acme Co', slug: 'acme-co', role: 'owner', timezone: 'America/New_York', defaultCurrency: 'USD' })

    const second = await createWorkspace(testUserId, { name: 'Acme  co!' })
    expect(second.slug).toBe('acme-co-2')

    const exec = (await executions(ws.id, 'workspace.create'))[0]!
    expect(exec).toMatchObject({ status: 'succeeded', actorKind: 'member', actorUserId: testUserId, origin: 'api', targetType: 'workspace', targetId: ws.id })
    expect(exec.actorMemberId).toBe(await memberId(ws.id, testUserId))
    const activity = await db.activity.findMany({ where: { workspaceId: ws.id } })
    expect(activity.map((a) => [a.type, a.actionExecutionId])).toEqual([['workspace.created', exec.id]])
  })

  it('requires a registered account (guests are asked to upgrade)', async () => {
    const res = await call(testOtherUserId, 'POST', '/workspaces', { name: 'Guest Co' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('REGISTRATION_REQUIRED')
  })

  it('rejects a taken slug, a bad slug and an unknown time zone', async () => {
    await createWorkspace(testUserId, { name: 'One', slug: 'taken' })
    expect((await call(testUserId, 'POST', '/workspaces', { name: 'Two', slug: 'taken' })).json().code).toBe('SLUG_TAKEN')
    expect((await call(testUserId, 'POST', '/workspaces', { name: 'Two', slug: 'Bad Slug' })).statusCode).toBe(400)
    expect((await call(testUserId, 'POST', '/workspaces', { name: 'Two', timezone: 'Mars/Olympus' })).json().code).toBe('INVALID_TIMEZONE')
  })
})

describe('workspace access', () => {
  // Spec-driven: every route under /workspaces/{workspaceId} must hide the
  // workspace from non-members, including routes added later.
  const spec = load(readFileSync(specPath, 'utf8')) as any
  const routes = Object.entries<any>(spec.paths)
    .filter(([path]) => path.startsWith('/workspaces/{workspaceId}'))
    .flatMap(([path, item]) => ['get', 'post', 'patch', 'put', 'delete'].filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m] })))

  it('covers every workspace route', () => {
    expect(routes.length).toBeGreaterThanOrEqual(45)
  })

  for (const { path, method, op } of routes) {
    it(`${op.operationId}: requires auth, and is 404 for non-members`, async () => {
      const ws = await createWorkspace()
      await seedPeople()
      // Required query parameters get a valid sample so the 404 comes from policy.
      const query = (op.parameters ?? []).filter((p: any) => p.in === 'query' && p.required).map((p: any) => `${p.name}=x%40test.local`).join('&')
      const url = path.replace('{workspaceId}', ws.id).replace(/\{[^}]+\}/g, 'x') + (query ? `?${query}` : '')
      // Multipart uploads get a tiny form, so the 404 comes from policy, not the parser.
      const form = op.requestBody?.content?.['multipart/form-data'] ? multipart([{ name: 'file', value: Buffer.from('x'), filename: 'x.png', type: 'image/png' }]) : null
      const body = method === 'get' ? undefined : form ? form.payload : op.requestBody ? sampleBody(op) : undefined
      expect((await app.inject({ method: method.toUpperCase() as any, url })).statusCode).toBe(401)
      const res = await call(daveId, method.toUpperCase(), url, body, form?.headers)
      expect(res.statusCode).toBe(404)
    })
  }

  it('deleted workspaces disappear for their members', async () => {
    const ws = await createWorkspace()
    const del = await call(testUserId, 'DELETE', `/workspaces/${ws.id}`)
    expect(del.statusCode).toBe(200)
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}`)).statusCode).toBe(404)
    expect((await call(testUserId, 'GET', '/workspaces')).json().data).toEqual([])
  })
})

// A minimal valid body per input schema, so the 404 comes from policy, not validation.
function sampleBody(op: any) {
  const ref: string = op.requestBody.content['application/json'].schema.$ref ?? ''
  const name = ref.split('/').pop()
  const samples: Record<string, object> = {
    CreateDocumentInput: { title: 'x', descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }, idempotencyKey: 'x' },
    ImportDocumentCsvInput: { title: 'x', csv: 'Header\nValue', filename: 'x.csv', idempotencyKey: 'x' },
    UpdateDocumentInput: { expectedVersion: 1, title: 'x' },
    DocumentVersionInput: { expectedVersion: 1 },
    SetDocumentGrantInput: { role: 'viewer' },
    DatasetWriteInput: { expectedVersion: 1, idempotencyKey: 'x', changes: { title: 'x' } },
    DatasetQueryInput: { query: { columns: ['id'] } },
    DatasetExportInput: { query: { columns: ['id'] } },
    CreateContactsReviewInput: { title: 'x', query: { columns: ['id'] }, idempotencyKey: 'x' },
    UpdateWorkspaceInput: { name: 'x' },
    UpdateWorkspaceMemberInput: { title: 'x' },
    CreateWorkspaceInviteInput: { email: 'x@test.local' },
    CreateTeamInput: { name: 'x' },
    UpdateTeamInput: { name: 'x' },
    SetTeamMemberInput: {},
    CreateAccountInput: { name: 'x' },
    MergeContactsInput: { mergeContactId: 'x' },
    CreateInventoryInput: { name: 'x' },
    UpdateInventoryInput: { expectedVersion: 1, name: 'x' },
    CreateProposalInput: { kind: 'company-profile.fact', targetId: 'x', change: {} },
    EditProposalInput: { edits: {} },
    ReorderRecordImagesInput: { imageIds: ['x'] },
    BulkContactsInput: { ids: ['x'], action: 'archive' },
    BulkInventoryInput: { ids: ['x'], action: 'archive' },
    AdjustInventoryStockInput: { expectedVersion: 1, quantity: 0 },
    ResolveInventoryImportRowInput: { action: 'skip' },
    CreateInventoryImportInput: { source: { kind: 'csv', csv: 'Name\nA', filename: 'x.csv' } },
    AddInterestInput: { inventoryId: 'x' },
    CreateTagInput: { name: 'x' },
    ShareMessageInput: { roomIds: ['x'] },
    CreateContactImportInput: { source: { kind: 'csv', csv: 'Name\nx', filename: 'x.csv' } },
    ResolveContactImportRowInput: { action: 'skip' },
    SaveDocumentContentInput: { expectedVersion: 0, content: [] },
    SetDocumentWorkspaceAccessInput: { role: 'viewer' },
    ReadInboxItemInput: { unread: false },
    StarInboxItemInput: { starred: true },
    ArchiveInboxItemInput: { archived: true },
    SendComposeInput: { contactId: 'x', channel: 'email', destination: 'a@b.co', subject: 'x', body: 'x', contextType: 'contact', contextId: 'x' },
    DocumentPresenceInput: { editing: true },
  }
  return samples[name ?? ''] ?? {}
}

describe('invites', () => {
  it('a registered invitee joins with the invited role; the token works once', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const invite = await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'Carol@Test.local', role: 'admin' })
    expect(invite.statusCode).toBe(201)
    await validateResponse('createWorkspaceInvite', 201, invite.json())
    expect(invite.json().data.email).toBe('carol@test.local')
    const stored = await db.workspaceInvite.findUniqueOrThrow({ where: { id: invite.json().data.id } })
    expect(stored.tokenHash).not.toContain(invite.json().token) // only the hash is kept

    const accept = await call(carolId, 'POST', '/workspace-invites/accept', { token: invite.json().token })
    expect(accept.statusCode).toBe(200)
    await validateResponse('acceptWorkspaceInvite', 200, accept.json())
    expect(accept.json().data).toMatchObject({ id: ws.id, role: 'admin' })

    const again = await call(carolId, 'POST', '/workspace-invites/accept', { token: invite.json().token })
    expect(again.json().code).toBe('INVITE_INVALID')

    const members = await call(carolId, 'GET', `/workspaces/${ws.id}/members`)
    await validateResponse('listWorkspaceMembers', 200, members.json())
    expect(members.json().data.map((m: any) => [m.user.name, m.role])).toEqual([['Alice', 'owner'], ['Carol', 'admin']])

    const joined = await db.activity.findFirstOrThrow({ where: { workspaceId: ws.id, type: 'member.joined' } })
    expect(joined.actorMemberId).toBe(await memberId(ws.id, carolId))
  })

  it('refuses guests, other accounts, revoked, replaced and expired invites', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const first = (await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'carol@test.local' })).json()

    expect((await call(testOtherUserId, 'POST', '/workspace-invites/accept', { token: first.token })).json().code).toBe('REGISTRATION_REQUIRED')
    expect((await call(daveId, 'POST', '/workspace-invites/accept', { token: first.token })).json().code).toBe('INVITE_EMAIL_MISMATCH')

    // A new invite for the same email replaces the pending one.
    const second = (await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'carol@test.local' })).json()
    expect((await call(carolId, 'POST', '/workspace-invites/accept', { token: first.token })).json().code).toBe('INVITE_INVALID')
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/invites`)).json().data.map((i: any) => i.id)).toEqual([second.data.id])

    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/invites/${second.data.id}`)).statusCode).toBe(200)
    expect((await call(carolId, 'POST', '/workspace-invites/accept', { token: second.token })).json().code).toBe('INVITE_INVALID')

    const third = (await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'carol@test.local' })).json()
    await db.workspaceInvite.update({ where: { id: third.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call(carolId, 'POST', '/workspace-invites/accept', { token: third.token })).json().code).toBe('INVITE_INVALID')
  })

  it('only admins invite; existing members are not re-invited', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    await join(ws.id, carolId, 'carol@test.local')
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'dave@test.local' })).statusCode).toBe(403)
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}/invites`)).statusCode).toBe(403)
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'carol@test.local' })).json().code).toBe('ALREADY_MEMBER')
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/invites`, { email: 'x@test.local', role: 'owner' })).statusCode).toBe(400)
  })
})

describe('members and roles', () => {
  it('only owners touch owners; a workspace keeps an active owner', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const alice = await memberId(ws.id, testUserId)
    const carol = await join(ws.id, carolId, 'carol@test.local', 'admin')
    const dave = await join(ws.id, daveId, 'dave@test.local')

    // Admin: can't touch the owner or grant ownership, can manage members.
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${alice}`, { role: 'member' })).statusCode).toBe(403)
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${dave}`, { role: 'owner' })).statusCode).toBe(403)
    const promoted = await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${dave}`, { role: 'admin' })
    expect(promoted.statusCode).toBe(200)
    await validateResponse('updateWorkspaceMember', 200, promoted.json())

    // Last owner can't step down or leave…
    const demote = await call(testUserId, 'PATCH', `/workspaces/${ws.id}/members/${alice}`, { role: 'admin' })
    expect(demote.json().code).toBe('LAST_OWNER')
    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/members/${alice}`)).json().code).toBe('LAST_OWNER')
    // …until there is another.
    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/members/${carol}`, { role: 'owner' })).statusCode).toBe(200)
    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/members/${alice}`, { role: 'admin' })).statusCode).toBe(200)

    // The refused attempt is in the audit log as rejected; the change has a field diff.
    const updates = await executions(ws.id, 'member.update')
    expect(updates.filter((e) => e.status === 'rejected').map((e) => e.errorCode)).toEqual(['LAST_OWNER'])
    expect(updates.find((e) => e.targetId === dave && e.status === 'succeeded')?.changes).toEqual({ role: ['member', 'admin'] })
  })

  it('members edit only their own profile fields; suspension blocks access', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const carol = await join(ws.id, carolId, 'carol@test.local')
    const dave = await join(ws.id, daveId, 'dave@test.local')

    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${carol}`, { title: 'AE', timezone: 'Europe/Paris' })).json().data).toMatchObject({ title: 'AE', timezone: 'Europe/Paris' })
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${dave}`, { title: 'x' })).statusCode).toBe(403)
    expect((await call(carolId, 'PATCH', `/workspaces/${ws.id}/members/${carol}`, { role: 'admin' })).statusCode).toBe(403)

    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/members/${carol}`, { status: 'suspended' })).statusCode).toBe(200)
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}`)).json().code).toBe('MEMBER_SUSPENDED')
    expect((await call(carolId, 'GET', '/workspaces')).json().data).toEqual([])
    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/members/${await memberId(ws.id, testUserId)}`, { status: 'suspended' })).statusCode).toBe(400)
  })

  it('removal keeps the row, ends team memberships, and a new invite re-activates it', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const carol = await join(ws.id, carolId, 'carol@test.local')
    const team = (await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' })).json().data
    await call(testUserId, 'PUT', `/workspaces/${ws.id}/teams/${team.id}/members/${carol}`, {})

    expect((await call(testUserId, 'DELETE', `/workspaces/${ws.id}/members/${carol}`)).statusCode).toBe(200)
    expect((await call(carolId, 'GET', `/workspaces/${ws.id}`)).statusCode).toBe(404)
    expect(await db.teamMember.count({ where: { memberId: carol } })).toBe(0)
    const all = (await call(testUserId, 'GET', `/workspaces/${ws.id}/members?includeRemoved=true`)).json().data
    expect(all.find((m: any) => m.id === carol)).toMatchObject({ status: 'removed' })

    expect(await join(ws.id, carolId, 'carol@test.local')).toBe(carol) // same member id
    expect((await call(carolId, 'DELETE', `/workspaces/${ws.id}/members/${carol}`)).statusCode).toBe(200) // leave
    const types = (await db.activity.findMany({ where: { workspaceId: ws.id }, orderBy: { recordedAt: 'asc' } })).map((a) => a.type)
    expect(types).toEqual(expect.arrayContaining(['member.removed', 'member.left']))
  })
})

describe('teams', () => {
  it('admins create teams; names are unique; an Idempotency-Key makes create safe to retry', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    await join(ws.id, carolId, 'carol@test.local')
    expect((await call(carolId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' })).statusCode).toBe(403)

    const key = { 'idempotency-key': 'create-sales-1' }
    const first = await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' }, key)
    expect(first.statusCode).toBe(201)
    await validateResponse('createTeam', 201, first.json())
    const repeat = await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' }, key)
    expect(repeat.statusCode).toBe(201)
    expect(repeat.json().data.id).toBe(first.json().data.id)
    expect(await db.team.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect((await executions(ws.id, 'team.create')).length).toBe(1)

    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Support' }, key)).json().code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect((await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' })).json().code).toBe('TEAM_NAME_TAKEN')
  })

  it('leads manage their own team; members may leave; archived teams take no one new', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    const carol = await join(ws.id, carolId, 'carol@test.local')
    const dave = await join(ws.id, daveId, 'dave@test.local')
    const sales = (await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Sales' })).json().data
    const other = (await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name: 'Support' })).json().data

    expect((await call(carolId, 'PUT', `/workspaces/${ws.id}/teams/${sales.id}/members/${dave}`, {})).statusCode).toBe(403)
    await call(testUserId, 'PUT', `/workspaces/${ws.id}/teams/${sales.id}/members/${carol}`, { role: 'lead' })
    const added = await call(carolId, 'PUT', `/workspaces/${ws.id}/teams/${sales.id}/members/${dave}`, {})
    expect(added.statusCode).toBe(200)
    await validateResponse('setTeamMember', 200, added.json())
    expect(added.json().data.members).toEqual([{ memberId: carol, role: 'lead' }, { memberId: dave, role: 'member' }])
    expect((await call(carolId, 'PUT', `/workspaces/${ws.id}/teams/${other.id}/members/${dave}`, {})).statusCode).toBe(403) // not their team

    expect((await call(daveId, 'DELETE', `/workspaces/${ws.id}/teams/${sales.id}/members/${dave}`)).statusCode).toBe(200)

    expect((await call(testUserId, 'PATCH', `/workspaces/${ws.id}/teams/${sales.id}`, { archived: true })).json().data.archivedAt).toBeTruthy()
    expect((await call(testUserId, 'PUT', `/workspaces/${ws.id}/teams/${sales.id}/members/${dave}`, {})).json().code).toBe('TEAM_ARCHIVED')
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/teams`)).json().data.map((t: any) => t.name)).toEqual(['Support'])
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/teams?includeArchived=true`)).json().data).toHaveLength(2)
  })

  it('never links rows across workspaces', async () => {
    const a = await createWorkspace(testUserId, { name: 'A' })
    const b = await createWorkspace(testUserId, { name: 'B' })
    await seedPeople()
    const carolInB = await join(b.id, carolId, 'carol@test.local')
    const teamA = (await call(testUserId, 'POST', `/workspaces/${a.id}/teams`, { name: 'Sales' })).json().data
    const teamB = (await call(testUserId, 'POST', `/workspaces/${b.id}/teams`, { name: 'Sales' })).json().data

    // A member of B can't be put in A's team, nor B's team reached through A.
    expect((await call(testUserId, 'PUT', `/workspaces/${a.id}/teams/${teamA.id}/members/${carolInB}`, {})).statusCode).toBe(404)
    expect((await call(testUserId, 'PATCH', `/workspaces/${a.id}/teams/${teamB.id}`, { name: 'x' })).statusCode).toBe(404)
    expect((await call(testUserId, 'PATCH', `/workspaces/${a.id}/members/${carolInB}`, { title: 'x' })).statusCode).toBe(404)
    await call(testUserId, 'PUT', `/workspaces/${b.id}/teams/${teamB.id}/members/${carolInB}`, { role: 'lead' })

    expect(await crossWorkspaceViolations()).toEqual({})
  })
})

describe('timeline and audit', () => {
  it('members read the timeline newest first, page by page; only admins read the audit log', async () => {
    const ws = await createWorkspace()
    await seedPeople()
    await join(ws.id, carolId, 'carol@test.local')
    for (const name of ['One', 'Two', 'Three']) await call(testUserId, 'POST', `/workspaces/${ws.id}/teams`, { name })

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      const res = await call(carolId, 'GET', `/workspaces/${ws.id}/activity?limit=2${qs}`)
      expect(res.statusCode).toBe(200)
      await validateResponse('listWorkspaceActivity', 200, res.json())
      seen.push(...res.json().data.map((a: any) => a.type))
      cursor = res.json().meta.nextCursor
    } while (cursor)
    expect(seen).toEqual(['team.created', 'team.created', 'team.created', 'member.joined', 'member.invited', 'workspace.created'])

    expect((await call(carolId, 'GET', `/workspaces/${ws.id}/actions`)).statusCode).toBe(403)
    const audit = await call(testUserId, 'GET', `/workspaces/${ws.id}/actions?targetType=team`)
    expect(audit.statusCode).toBe(200)
    await validateResponse('listWorkspaceActions', 200, audit.json())
    expect(audit.json().data.map((e: any) => e.action)).toEqual(['team.create', 'team.create', 'team.create'])
    expect((await call(testUserId, 'GET', `/workspaces/${ws.id}/activity?cursor=garbage`)).statusCode).toBe(400)
  })
})

describe('policy', () => {
  const member = (role: 'owner' | 'admin' | 'member', status: 'active' | 'suspended' | 'removed' = 'active') => ({ id: `m-${role}`, role, status })

  it('V1 is broad for reads, admin for management, owner for ownership', () => {
    const reads: WorkspaceVerb[] = ['workspace.read', 'member.read', 'team.read', 'activity.read']
    for (const verb of reads) for (const role of ['owner', 'admin', 'member'] as const) expect(can(member(role), verb)).toBe(true)
    for (const verb of ['workspace.update', 'member.invite', 'member.manage', 'team.manage', 'audit.read'] as const) {
      expect([can(member('owner'), verb), can(member('admin'), verb), can(member('member'), verb)]).toEqual([true, true, false])
    }
    expect([can(member('owner'), 'workspace.delete'), can(member('admin'), 'workspace.delete')]).toEqual([true, false])
    expect(can(member('admin'), 'member.manage', { kind: 'member', role: 'owner' })).toBe(false)
    expect(can(member('admin'), 'member.manage', { kind: 'member', role: 'member', grant: 'owner' })).toBe(false)
    expect(can(member('owner'), 'member.manage', { kind: 'member', role: 'owner', grant: 'admin' })).toBe(true)
    expect(can(member('member'), 'team.members.manage', { kind: 'team', leadMemberIds: ['m-member'] })).toBe(true)
    expect(can(member('owner', 'suspended'), 'workspace.read')).toBe(false)
  })
})
