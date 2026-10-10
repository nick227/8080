import { useCallback, useMemo, useRef, useState } from 'react'
import type { Proposal } from '@project/sdk'
import { useChooseOption, useDeleteItem, useEditProposal, useProposalAction } from '@project/sdk'
import { isHumanAuthored } from '@project/shared'
import type { Item, SendInput } from '../../api/types'
import { useCurrentWorkspace } from '../../app/workspace'
import { stillsFrom, type StreamRow } from './ChatStream'
import type { ProposalAct } from './ProposalCard'
import { markRead, readNumber } from './readCursor'
import type { PendingPost } from './useRoomPost'

// What a chat link opens, as its small label ('' = none: the title says it).
const LINK_KIND: Record<string, string> = { document: 'Document', contact: 'Contact', compose: 'Contact', profile: '' }

export type ChatLink = { type: string; id: string; workspaceId: string }

/**
 * A room's chat rows, shared by the room page and the company channel rail (redesign
 * D4): live items + pending sends, proposal and choice actions, delete, and the read
 * cursor (catch-up + the first unread anchor). What reply and links do is the page's call.
 */
export function useChatRows(opts: {
  roomId: string | undefined
  meId: string | undefined
  visible: Item[]
  pending: PendingPost[]
  send: (input: SendInput, retryId?: string) => Promise<unknown>
  onReply?: (id: string) => void
  onOpenLink: (link: ChatLink) => void
  onError: (message: string) => void
}) {
  const { roomId, meId, visible, pending, send } = opts
  const { workspace } = useCurrentWorkspace()
  const role = workspace?.role
  const chooseOption = useChooseOption()
  const removeItem = useDeleteItem()
  // Proposal cards (doc/13 §5): the workspace's own rows; owners/admins decide.
  const proposalAction = useProposalAction(workspace?.id ?? '')
  const proposalEdit = useEditProposal(workspace?.id ?? '')

  // Row actions go through a ref so cached rows never hold stale closures.
  const actions = useRef({
    act: (_proposalId: string, _action: ProposalAct): Promise<Proposal> => Promise.reject(new Error('not ready')),
    edit: (_proposalId: string, _edits: Record<string, string>): Promise<Proposal> => Promise.reject(new Error('not ready')),
    reply: (_id: string) => {},
    remove: (_id: string) => {},
    choose: async (_id: string, _optionIds: string[]) => {},
    openLink: (_link: ChatLink) => {},
  })
  actions.current = {
    act: (proposalId, action) => proposalAction.mutateAsync({ proposalId, action }),
    edit: (proposalId, edits) => proposalEdit.mutateAsync({ proposalId, edits }),
    openLink: opts.onOpenLink,
    choose: async (itemId, optionIds) => { await chooseOption.mutateAsync({ itemId, optionIds }) },
    reply: (id) => opts.onReply?.(id),
    remove: (id) => {
      void removeItem.mutateAsync(id).catch((error: unknown) => {
        opts.onError(error instanceof Error ? error.message : 'Could not delete')
      })
    },
  }
  const canReply = Boolean(opts.onReply)

  // One row object per item, reused while the item (and who is viewing) is unchanged,
  // so a live event re-renders only the row it touched.
  const rowCache = useRef(new WeakMap<Item, { meId: string | undefined; role: string | undefined; row: StreamRow }>())
  const rowFor = useCallback((item: Item): StreamRow => {
    const cached = rowCache.current.get(item)
    if (cached && cached.meId === meId && cached.role === role) return cached.row
    const row: StreamRow = {
      id: item.id,
      authorId: item.author.id,
      tag: item.author.tag,
      author: item.author.name,
      avatarUrl: item.author.avatarUrl,
      postedAt: item.createdAt,
      text: item.text,
      media: stillsFrom(item.media),
      proposal: item.proposal
        ? { proposal: item.proposal, canDecide: item.proposal.requires === 'member' || role === 'owner' || role === 'admin', onAct: (action) => actions.current.act(item.proposal!.id, action), onEdit: (edits) => actions.current.edit(item.proposal!.id, edits) }
        : undefined,
      choice: item.actions
        ? { actions: item.actions, choice: item.choice, meId, onChoose: (optionIds) => actions.current.choose(item.id, optionIds) }
        : undefined,
      links: item.links?.map((link) => ({ id: link.id, type: link.type, title: link.title, kind: LINK_KIND[link.type] ?? '', onOpen: () => actions.current.openLink(link) })),
      onReply: canReply ? () => actions.current.reply(item.id) : undefined,
      onDelete: item.author.id === meId ? () => actions.current.remove(item.id) : undefined,
    }
    rowCache.current.set(item, { meId, role, row })
    return row
  }, [meId, role, canReply])

  const pendingRows: StreamRow[] = useMemo(() => pending.map((item) => ({
    id: item.id,
    authorId: meId,
    author: item.author,
    avatarUrl: item.avatarUrl,
    text: item.text,
    media: item.media,
    status: item.status,
    onRetry: item.status === 'failed' ? () => void send(item.input, item.id) : undefined,
  })), [pending, meId, send])

  const rows: StreamRow[] = useMemo(() => [
    ...visible.map(rowFor),
    ...pendingRows,
  ], [visible, pendingRows, rowFor])

  const [readMark, setReadMark] = useState(0)
  const latestNumber = visible.at(-1)?.number
  const catchUp = useCallback(() => {
    if (!meId || !roomId || latestNumber == null) return
    if ((readNumber(meId, roomId) ?? -1) >= latestNumber) return
    markRead(meId, roomId, latestNumber)
    setReadMark((n) => n + 1)
  }, [meId, roomId, latestNumber])
  const stored = meId && roomId ? readNumber(meId, roomId) : null
  // Bot items never make a room unread (doc/08 I6).
  const anchorId = stored == null || readMark < 0 ? undefined : visible.find((item) => item.number > stored && isHumanAuthored(item))?.id

  return { rows, catchUp, anchorId }
}
