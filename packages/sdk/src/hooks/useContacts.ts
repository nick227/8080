import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApiClient, unwrap } from '../client'
import type {
  AccountType,
  CreateAccountInput,
  CreateContactInput,
  CreateNoteInput,
  CreateRecordLinkInput,
  CreateTagInput,
  RecordStatus,
  SetContactAccountInput,
  UpdateAccountInput,
  UpdateContactInput,
  UpdateTagInput,
} from '../models'
import { keys } from './keys'

// Contacts, accounts, tags, notes and record links (doc/09 slice 1). These are
// domain capabilities, not a page: the same hooks serve Work, Sales, Inbox, Team
// tiles or search. Mutations invalidate the workspace subtree (records, timelines
// and activity all move together).

type Subject = { contactId: string } | { accountId: string }
const subjectKeyOf = (s: Subject) => ('contactId' in s ? `contact:${s.contactId}` : `account:${s.accountId}`)

function useWorkspaceWrite<V, R>(workspaceId: string, fn: (vars: V) => Promise<R>, also?: (vars: V) => readonly unknown[][]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
      for (const key of also?.(vars) ?? []) void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

const ws = (workspaceId: string) => ({ workspaceId })

// ─── contacts ────────────────────────────────────────────────────────────────

export type ContactListParams = { q?: string; ownerMemberId?: string; tagId?: string; accountId?: string; status?: RecordStatus; limit?: number }

export function useContacts(workspaceId: string | undefined, params: ContactListParams = {}) {
  return useInfiniteQuery({
    queryKey: keys.contacts(workspaceId ?? '', params),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts', { params: { path: ws(workspaceId!), query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

/** A merged contact resolves to its survivor — compare `data.id` with the id you asked for. */
export function useContact(workspaceId: string | undefined, contactId: string | undefined) {
  return useQuery({
    queryKey: keys.contact(workspaceId ?? '', contactId ?? ''),
    enabled: !!workspaceId && !!contactId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}', { params: { path: { workspaceId: workspaceId!, contactId: contactId! } } })).data,
  })
}

/** Resolves to `{ data, duplicates }`: likely duplicates are reported, never refused. */
export function useCreateContact(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: CreateContactInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contacts', { params: { path: ws(workspaceId) }, body })),
  )
}

export function useUpdateContact(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ contactId, ...body }: UpdateContactInput & { contactId: string }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/contacts/{contactId}', { params: { path: { workspaceId, contactId } }, body })).data,
  )
}

export function useDeleteContact(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (contactId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/contacts/{contactId}', { params: { path: { workspaceId, contactId } } }))
  })
}

/** What the matcher concludes for an email (match / ambiguous / shared / none), plus its domain's account. */
export function useContactMatch(workspaceId: string | undefined, email: string | undefined) {
  return useQuery({
    queryKey: [...keys.contacts(workspaceId ?? ''), 'match', email ?? ''],
    enabled: !!workspaceId && !!email,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/match', { params: { path: ws(workspaceId!), query: { email: email! } } })).data,
  })
}

export function useContactDuplicates(workspaceId: string | undefined, contactId: string | undefined) {
  return useQuery({
    queryKey: [...keys.contact(workspaceId ?? '', contactId ?? ''), 'duplicates'],
    enabled: !!workspaceId && !!contactId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}/duplicates', { params: { path: { workspaceId: workspaceId!, contactId: contactId! } } })).data,
  })
}

/** Folds `mergeContactId` into `contactId` (the survivor). */
export function useMergeContacts(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ contactId, mergeContactId }: { contactId: string; mergeContactId: string }) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contacts/{contactId}/merge', { params: { path: { workspaceId, contactId } }, body: { mergeContactId } })).data,
  )
}

/** Links a contact to an account (or updates the link); `remove: true` deletes it. */
export function useSetContactAccount(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ contactId, accountId, remove, ...body }: SetContactAccountInput & { contactId: string; accountId: string; remove?: boolean }) => {
    const params = { params: { path: { workspaceId, contactId, accountId } } }
    return remove
      ? unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/contacts/{contactId}/accounts/{accountId}', params)).data
      : unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/contacts/{contactId}/accounts/{accountId}', { ...params, body })).data
  })
}

// ─── accounts ────────────────────────────────────────────────────────────────

export type AccountListParams = { q?: string; ownerMemberId?: string; tagId?: string; type?: AccountType; status?: RecordStatus; limit?: number }

export function useAccounts(workspaceId: string | undefined, params: AccountListParams = {}) {
  return useInfiniteQuery({
    queryKey: keys.accounts(workspaceId ?? '', params),
    enabled: !!workspaceId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/accounts', { params: { path: ws(workspaceId!), query: { ...params, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

export function useAccount(workspaceId: string | undefined, accountId: string | undefined) {
  return useQuery({
    queryKey: keys.account(workspaceId ?? '', accountId ?? ''),
    enabled: !!workspaceId && !!accountId,
    queryFn: async () =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/accounts/{accountId}', { params: { path: { workspaceId: workspaceId!, accountId: accountId! } } })).data,
  })
}

/** Resolves to `{ data, duplicates }` (accounts with the same domain). */
export function useCreateAccount(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: CreateAccountInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/accounts', { params: { path: ws(workspaceId) }, body })),
  )
}

export function useUpdateAccount(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ accountId, ...body }: UpdateAccountInput & { accountId: string }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/accounts/{accountId}', { params: { path: { workspaceId, accountId } }, body })).data,
  )
}

export function useDeleteAccount(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (accountId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/accounts/{accountId}', { params: { path: { workspaceId, accountId } } }))
  })
}

// ─── timelines ───────────────────────────────────────────────────────────────

/** A contact's or account's timeline, newest first. */
export function useRecordTimeline(workspaceId: string | undefined, subject: Subject | undefined, params: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.timeline(workspaceId ?? '', subject ? subjectKeyOf(subject) : ''),
    enabled: !!workspaceId && !!subject,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const query = { ...params, cursor: pageParam }
      return subject && 'contactId' in subject
        ? unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}/timeline', { params: { path: { workspaceId: workspaceId!, contactId: subject.contactId }, query } }))
        : unwrap(await getApiClient().GET('/workspaces/{workspaceId}/accounts/{accountId}/timeline', { params: { path: { workspaceId: workspaceId!, accountId: (subject as { accountId: string }).accountId }, query } }))
    },
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

// ─── tags ────────────────────────────────────────────────────────────────────

export function useTags(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.tags(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/tags', { params: { path: ws(workspaceId!) } })).data,
  })
}

export function useCreateTag(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: CreateTagInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/tags', { params: { path: ws(workspaceId) }, body })).data,
  )
}

/** Owner/admin. `remove: true` deletes the tag from every record. */
export function useUpdateTag(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ tagId, remove, ...body }: UpdateTagInput & { tagId: string; remove?: boolean }) => {
    const params = { params: { path: { workspaceId, tagId } } }
    if (remove) {
      unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/tags/{tagId}', params))
      return null
    }
    return unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/tags/{tagId}', { ...params, body })).data
  })
}

// ─── notes ───────────────────────────────────────────────────────────────────

export function useNotes(workspaceId: string | undefined, subject: Subject | undefined, params: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: keys.notes(workspaceId ?? '', subject ? subjectKeyOf(subject) : ''),
    enabled: !!workspaceId && !!subject,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await getApiClient().GET('/workspaces/{workspaceId}/notes', { params: { path: ws(workspaceId!), query: { ...params, ...subject, cursor: pageParam } } })),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
}

/** Text and/or media (the caller's own uploads, e.g. a voice capture) on contacts/accounts. */
export function useCreateNote(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (body: CreateNoteInput) =>
    unwrap(await getApiClient().POST('/workspaces/{workspaceId}/notes', { params: { path: ws(workspaceId) }, body })).data,
  )
}

export function usePinNote(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async ({ noteId, pinned }: { noteId: string; pinned: boolean }) =>
    unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/notes/{noteId}', { params: { path: { workspaceId, noteId } }, body: { pinned } })).data,
  )
}

export function useDeleteNote(workspaceId: string) {
  return useWorkspaceWrite(workspaceId, async (noteId: string) => {
    unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/notes/{noteId}', { params: { path: { workspaceId, noteId } } }))
  })
}

/** Author only. Places the note's capture in each room; returns the new Items. */
export function useShareNote(workspaceId: string) {
  return useWorkspaceWrite(
    workspaceId,
    async ({ noteId, roomIds }: { noteId: string; roomIds: string[] }) =>
      unwrap(await getApiClient().POST('/workspaces/{workspaceId}/notes/{noteId}/share', { params: { path: { workspaceId, noteId } }, body: { roomIds } })).data,
    ({ roomIds }) => roomIds.map((roomId) => [...keys.items(roomId)]),
  )
}

// ─── links ───────────────────────────────────────────────────────────────────

export type LinkFilter = { contactId: string } | { accountId: string } | { noteId: string } | { roomId: string }

export function useRecordLinks(workspaceId: string | undefined, filter: LinkFilter | undefined) {
  return useQuery({
    queryKey: keys.links(workspaceId ?? '', filter ?? {}),
    enabled: !!workspaceId && !!filter,
    queryFn: async () => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/links', { params: { path: ws(workspaceId!), query: filter } })).data,
  })
}

/** Records linked to a conversation, from the caller's workspaces (the room tile). */
export function useRoomLinks(roomId: string | undefined) {
  return useQuery({
    queryKey: keys.roomLinks(roomId ?? ''),
    enabled: !!roomId,
    queryFn: async () => unwrap(await getApiClient().GET('/rooms/{roomId}/links', { params: { path: { roomId: roomId! } } })).data,
  })
}

export function useLinkRecord(workspaceId: string) {
  return useWorkspaceWrite(
    workspaceId,
    async (body: CreateRecordLinkInput) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/links', { params: { path: ws(workspaceId) }, body })).data,
    (body) => (body.roomId ? [[...keys.roomLinks(body.roomId)]] : []),
  )
}

export function useUnlinkRecord(workspaceId: string) {
  return useWorkspaceWrite(
    workspaceId,
    async ({ linkId }: { linkId: string; roomId?: string }) => {
      unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/links/{linkId}', { params: { path: { workspaceId, linkId } } }))
    },
    ({ roomId }) => (roomId ? [[...keys.roomLinks(roomId)]] : []),
  )
}
