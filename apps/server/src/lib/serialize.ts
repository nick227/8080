// Prisma rows → API shapes (packages/api-spec). The only place DB fields are
// renamed or hidden: kind→type, posterUrl→poster, storageKey→url, no passwordHash.
import type { Prisma, ReactionType, WorkspaceRole } from '@project/db'
import { youTubeThumbnailUrl, youTubeWatchUrl } from '@project/shared'
import { playbackToken } from './playbackToken'
import { json, type MessageLink, type StoredActions, type StoredChoice } from './choice'
import { proposalInclude, toProposal } from './proposal'

// ─── users ───────────────────────────────────────────────────────────────────

export type UserRow = Prisma.UserGetPayload<{ include: { profile: true } }>

// Disclosure is data (doc/08 I7): every name renders with its tag, whatever it is.
export const userTag = (user: { kind: string }) => (user.kind === 'bot' ? 'BOT' : null)

export function toUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    isGuest: user.isGuest,
    kind: user.kind,
    tag: userTag(user),
    displayName: user.profile?.displayName ?? 'Guest',
    avatarUrl: user.profile?.avatarUrl ?? null,
    createdAt: user.createdAt,
  }
}

export function toAuthor(user: UserRow) {
  return {
    id: user.id,
    name: user.profile?.displayName ?? 'Guest',
    avatarUrl: user.profile?.avatarUrl ?? null,
    kind: user.kind,
    tag: userTag(user),
  }
}

// ─── rooms ───────────────────────────────────────────────────────────────────

export function roomInclude(viewerId: string) {
  return {
    thumbnail: true,
    _count: { select: { members: true } },
    members: { where: { userId: viewerId }, select: { role: true } },
  } satisfies Prisma.RoomInclude
}

export type RoomRow = Prisma.RoomGetPayload<{ include: ReturnType<typeof roomInclude> }>

// `fallback`: the room's earliest picture, shown when no thumbnail is set (rooms
// from before thumbnails were required, or whose thumbnail file was deleted).
export function toRoom(room: RoomRow, fallback: MediaRow | null = null) {
  const role = room.members[0]?.role ?? null
  return {
    id: room.id,
    number: room.number,
    title: room.title,
    description: room.description ?? '',
    thumbnail: room.thumbnail ? toMedia(room.thumbnail) : fallback ? toMedia(fallback) : null,
    topic: room.topic,
    visibility: room.visibility,
    ownerId: room.ownerId,
    itemCount: room.itemCount,
    responseCount: room.responseCount,
    durationMs: room.durationMs,
    memberCount: room._count.members,
    lastActivityAt: room.lastActivityAt,
    lastResponseAt: room.lastResponseAt,
    createdAt: room.createdAt,
    role,
    // Only members of a private room may see (and share) its invite code.
    inviteCode: room.visibility === 'private' && role ? room.inviteCode : null,
  }
}

// ─── media ───────────────────────────────────────────────────────────────────

export type MediaRow = Prisma.MediaGetPayload<object>

/** The stored file's playback endpoint, without a token (for places that persist it, e.g. avatars). */
export const playbackUrl = (mediaId: string) => `${process.env.PUBLIC_API_URL ?? 'http://localhost:3001'}/media/${mediaId}/playback`

export function toMedia(media: MediaRow) {
  const youtube = media.source === 'youtube' && media.externalId
  return {
    id: media.id,
    type: media.kind,
    source: media.source,
    // External media is referenced, never stored: URL/poster derive from the id.
    // Stored media: the playback endpoint plus a short-lived token, so media elements
    // with crossOrigin="anonymous" (no cookies) can still play it.
    url: youtube ? youTubeWatchUrl(media.externalId!) : `${playbackUrl(media.id)}?token=${playbackToken(media.id)}`,
    mimeType: media.mimeType,
    size: media.size,
    duration: media.duration,
    name: media.name,
    poster: youtube ? youTubeThumbnailUrl(media.externalId!) : media.posterUrl,
    externalId: media.externalId,
    title: media.title,
    embeddable: media.embeddable,
  }
}

// ─── messages + items ────────────────────────────────────────────────────────
// Message = reusable content (author, text, media). Item = its placement in one
// room (number, thread position, reactions). Items always carry the hydrated message.

export const messageInclude = {
  author: { include: { profile: true } },
  media: { orderBy: { position: 'asc' } },
} satisfies Prisma.MessageInclude

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>

// `hidden` → this placement was deleted: content is withheld in this room only.
// The routing (flow, step) stays on the server; clients see only what to render.
function toActions(value: unknown) {
  const actions = json<StoredActions>(value)
  return actions ? { mode: actions.mode, options: actions.options, forUserId: actions.forUserId } : null
}

export function toMessage(message: MessageRow, hidden: boolean) {
  return {
    id: message.id,
    author: toAuthor(message.author),
    text: hidden ? null : message.text,
    media: hidden ? [] : message.media.map(toMedia),
    actions: hidden ? null : toActions(message.actions),
    choice: hidden ? null : json<StoredChoice>(message.choice),
    links: hidden ? [] : json<MessageLink[]>(message.links) ?? [],
    createdAt: message.createdAt,
  }
}

export const itemInclude = {
  message: { include: messageInclude },
  reactions: { select: { type: true, userId: true } },
  // The proposal this line renders as a card (doc/13 §5): the live row, not a copy.
  proposals: { take: 1, include: proposalInclude },
} satisfies Prisma.ItemInclude

export type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemInclude }>

const REACTION_ORDER: ReactionType[] = ['like', 'ack', 'laugh']

// viewerId null → broadcast payload (SSE): `reacted` is always false.
// `muted` = user ids this viewer muted (doc/08 I5): their items render in the hidden
// (tombstone) shape and their reactions are left out of this viewer's counts.
export function toItem(item: ItemRow, viewerId: string | null, muted?: ReadonlySet<string>) {
  const deleted = item.deletedAt !== null
  const hidden = deleted || (muted?.has(item.message.authorId) ?? false)
  let reactions: any[] = []
  if (!hidden && item.reactions.length > 0) {
    const counts: Record<string, number> = { like: 0, ack: 0, laugh: 0 }
    const reacted: Record<string, boolean> = { like: false, ack: false, laugh: false }
    for (const r of item.reactions) {
      if (muted?.has(r.userId)) continue
      counts[r.type] = (counts[r.type] || 0) + 1
      if (viewerId !== null && r.userId === viewerId) reacted[r.type] = true
    }
    reactions = REACTION_ORDER.filter((t) => (counts[t] || 0) > 0).map((t) => ({
      type: t,
      count: counts[t] || 0,
      reacted: reacted[t] || false,
    }))
  }

  return {
    id: item.id,
    roomId: item.roomId,
    messageId: item.messageId,
    number: item.number,
    parentId: item.parentId,
    anchorStartMs: item.anchorStartMs,
    chat: item.chat,
    message: toMessage(item.message, hidden),
    proposal: !hidden && item.proposals[0] ? toProposal(item.proposals[0]) : null,
    reactions,
    createdAt: item.createdAt,
    deletedAt: item.deletedAt,
  }
}

// ─── workspaces (doc/09) ─────────────────────────────────────────────────────

export function toWorkspace(workspace: Prisma.WorkspaceGetPayload<object>, role: WorkspaceRole) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    defaultCurrency: workspace.defaultCurrency,
    createdAt: workspace.createdAt,
    role,
  }
}

export const workspaceMemberInclude = { user: { include: { profile: true } } } satisfies Prisma.WorkspaceMemberInclude
export type WorkspaceMemberRow = Prisma.WorkspaceMemberGetPayload<{ include: typeof workspaceMemberInclude }>

// Members see each other's account email: it's a work directory.
export function toWorkspaceMember(member: WorkspaceMemberRow) {
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    user: toAuthor(member.user),
    email: member.user.email,
    role: member.role,
    status: member.status,
    title: member.title,
    timezone: member.timezone,
    joinedAt: member.joinedAt,
    removedAt: member.removedAt,
  }
}

// The token is never serialized here; createWorkspaceInvite returns it once, beside this.
export function toWorkspaceInvite(invite: Prisma.WorkspaceInviteGetPayload<object>) {
  return {
    id: invite.id,
    workspaceId: invite.workspaceId,
    email: invite.email,
    role: invite.role,
    invitedById: invite.invitedById,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  }
}

export const teamInclude = { members: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.TeamInclude
export type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>

export function toTeam(team: TeamRow) {
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    description: team.description,
    archivedAt: team.archivedAt,
    createdAt: team.createdAt,
    members: team.members.map((m) => ({ memberId: m.memberId, role: m.role })),
  }
}

export const activityInclude = {
  actorMember: { include: workspaceMemberInclude },
  subjects: { select: { subjectKey: true }, orderBy: { subjectKey: 'asc' } },
} satisfies Prisma.ActivityInclude
export type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>

export function toActivity(activity: ActivityRow) {
  return {
    id: activity.id,
    type: activity.type,
    occurredAt: activity.occurredAt,
    actorMemberId: activity.actorMemberId,
    actor: activity.actorMember ? toAuthor(activity.actorMember.user) : null,
    noteId: activity.noteId,
    roomId: activity.roomId,
    itemId: activity.itemId,
    taskId: activity.taskId,
    subjects: activity.subjects.map((s) => s.subjectKey),
    summary: (activity.summary ?? {}) as Record<string, unknown>,
  }
}

export function toActionExecution(execution: Prisma.ActionExecutionGetPayload<object>) {
  return {
    id: execution.id,
    action: execution.action,
    status: execution.status,
    actorKind: execution.actorKind,
    actorMemberId: execution.actorMemberId,
    actorUserId: execution.actorUserId,
    origin: execution.origin,
    targetType: execution.targetType,
    targetId: execution.targetId,
    input: execution.input,
    changes: execution.changes,
    result: execution.result,
    errorCode: execution.errorCode,
    requestedAt: execution.requestedAt,
    finishedAt: execution.finishedAt,
  }
}

// ─── contacts and accounts (doc/09 §4.1) ─────────────────────────────────────

export const contactInclude = {
  points: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
  accounts: { include: { account: { select: { id: true, name: true, deletedAt: true } } }, orderBy: { createdAt: 'asc' } },
  tags: { include: { tag: true } },
} satisfies Prisma.ContactInclude
export type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>

const toTag = (tag: Prisma.TagGetPayload<object>) => ({ id: tag.id, name: tag.name, color: tag.color })
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

export function toContact(contact: ContactRow) {
  return {
    id: contact.id,
    version: contact.version,
    workspaceId: contact.workspaceId,
    contacted: contact.contacted,
    qualified: contact.qualified,
    proposalSent: contact.proposalSent,
    won: contact.won,
    nextAction: contact.nextAction,
    interestedIn: contact.interestedIn,
    lastContactedAt: contact.lastContactedAt,
    priority: contact.priority,
    waitingOn: contact.waitingOn,
    potentialValue: contact.potentialValue == null ? null : Number(contact.potentialValue),
    fieldValues: contact.fieldValues ?? {},
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    title: contact.title,
    status: contact.status,
    ownerMemberId: contact.ownerMemberId,
    teamId: contact.teamId,
    leadStatus: contact.leadStatus,
    leadSource: contact.leadSource,
    nextFollowUp: contact.nextFollowUp,
    primaryEmail: contact.primaryEmail,
    primaryPhone: contact.primaryPhone,
    imageUrl: contact.imageUrl,
    lastActivityAt: contact.lastActivityAt,
    origin: contact.origin,
    externalProvider: contact.externalProvider,
    externalId: contact.externalId,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    points: contact.points.map((p) => ({ id: p.id, kind: p.kind, value: p.value, label: p.label, isPrimary: p.isPrimary, shared: p.shared })),
    accounts: contact.accounts
      .filter((ca) => !ca.account.deletedAt)
      .map((ca) => ({ accountId: ca.accountId, name: ca.account.name, role: ca.role, isPrimary: ca.isPrimary, startedAt: ca.startedAt, endedAt: ca.endedAt })),
    tags: contact.tags.map((ct) => toTag(ct.tag)).sort(byName),
  }
}

/** A short reference (match results, duplicates, links). */
export const toContactRef = (c: { id: string; displayName: string; primaryEmail: string | null }) => ({ id: c.id, displayName: c.displayName, primaryEmail: c.primaryEmail })

export const accountInclude = {
  tags: { include: { tag: true } },
  _count: { select: { contacts: { where: { endedAt: null, contact: { deletedAt: null } } } } },
} satisfies Prisma.AccountInclude
export type AccountRow = Prisma.AccountGetPayload<{ include: typeof accountInclude }>

export function toAccount(account: AccountRow) {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    name: account.name,
    domain: account.domain,
    website: account.website,
    industry: account.industry,
    sizeBand: account.sizeBand,
    type: account.type,
    status: account.status,
    parentAccountId: account.parentAccountId,
    ownerMemberId: account.ownerMemberId,
    teamId: account.teamId,
    lastActivityAt: account.lastActivityAt,
    origin: account.origin,
    externalProvider: account.externalProvider,
    externalId: account.externalId,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    contactCount: account._count.contacts,
    tags: account.tags.map((at) => toTag(at.tag)).sort(byName),
  }
}

export const toAccountRef = (a: { id: string; name: string; domain: string | null }) => ({ id: a.id, name: a.name, domain: a.domain })
export { toTag }

// ─── notes and links (doc/09 §3) ─────────────────────────────────────────────

export const noteInclude = {
  message: { include: messageInclude },
  authorMember: { select: { id: true } },
  links: { select: { contactId: true, accountId: true, inventoryId: true } },
} satisfies Prisma.NoteInclude
export type NoteRow = Prisma.NoteGetPayload<{ include: typeof noteInclude }>

const noteSubjectKey = (l: { contactId: string | null; accountId: string | null; inventoryId: string | null }) =>
  l.contactId ? `contact:${l.contactId}` : l.accountId ? `account:${l.accountId}` : `inventory:${l.inventoryId}`

// A capture deleted in a room is purged everywhere (purgeCapture), so the note can
// outlive its content: `contentRemoved` tells the UI why it's empty.
export function toNote(note: NoteRow) {
  const removed = note.message.deletedAt !== null
  return {
    id: note.id,
    workspaceId: note.workspaceId,
    messageId: note.messageId,
    authorMemberId: note.authorMemberId,
    author: toAuthor(note.message.author),
    text: removed ? null : note.message.text,
    media: removed ? [] : note.message.media.map(toMedia),
    contentRemoved: removed,
    pinnedAt: note.pinnedAt,
    createdAt: note.createdAt,
    subjects: note.links.map(noteSubjectKey).sort(),
  }
}

export const recordLinkInclude = {
  contact: { select: { id: true, displayName: true, primaryEmail: true, deletedAt: true } },
  account: { select: { id: true, name: true, domain: true, deletedAt: true } },
  inventory: { select: { id: true, name: true } },
  room: { select: { id: true, number: true, title: true, deletedAt: true } },
} satisfies Prisma.RecordLinkInclude
export type RecordLinkRow = Prisma.RecordLinkGetPayload<{ include: typeof recordLinkInclude }>

// `roomVisible`: rooms the viewer can't see stay anonymous (don't leak existence).
export function toRecordLink(link: RecordLinkRow, roomVisible: boolean) {
  const showRoom = link.roomId !== null && roomVisible && link.room !== null && !link.room.deletedAt
  return {
    id: link.id,
    workspaceId: link.workspaceId,
    subject: link.contact
      ? { type: 'contact' as const, id: link.contact.id, name: link.contact.displayName }
      : link.account
        ? { type: 'account' as const, id: link.account.id, name: link.account.name }
        : { type: 'inventory' as const, id: link.inventory!.id, name: link.inventory!.name },
    object: link.noteId
      ? { type: 'note' as const, noteId: link.noteId, room: null, itemId: null }
      : { type: link.itemId ? ('item' as const) : ('room' as const), noteId: null, room: showRoom ? { id: link.room!.id, number: link.room!.number, title: link.room!.title } : null, itemId: showRoom ? link.itemId : null },
    how: link.how,
    linkedById: link.linkedById,
    createdAt: link.createdAt,
  }
}
