import { useUI } from '../../state/ui'
import { useShell } from '../../state/shell'

// Replying from the River. The River lives in the Lobby sheet, but composing/recording
// happens on the record surface. When a reply (REPLY or REPLY HERE) starts on an item
// shown in the River, bring up the record surface; when the reply ends (sent or
// cancelled), return to the Lobby at the same River post.

const REPLY_STATES = new Set(['replying', 'composing', 'recording', 'reviewing'])
const riverPostOf = new Map<string, string>() // item id → River post (root) id
let returnTo: string | null = null

/** RiverConversation registers the items it shows (post + loaded replies). */
export function registerRiverItems(postId: string, itemIds: string[]) {
  for (const id of itemIds) riverPostOf.set(id, postId)
  return () => { for (const id of itemIds) if (riverPostOf.get(id) === postId) riverPostOf.delete(id) }
}

useUI.subscribe((ui, prev) => {
  const shell = useShell.getState()
  // Reply started from the River → compose on the record surface.
  if (ui.state === 'replying' && prev.state !== 'replying' && shell.surface === 'lobby' && ui.activeItemId && riverPostOf.has(ui.activeItemId)) {
    returnTo = riverPostOf.get(ui.activeItemId)!
    shell.openRecord()
    return
  }
  // Reply finished → back to the River, at that post.
  if (returnTo && REPLY_STATES.has(prev.state) && !REPLY_STATES.has(ui.state)) {
    const postId = returnTo
    returnTo = null
    if (useShell.getState().surface !== 'lobby') useShell.getState().showLobby()
    setTimeout(() => {
      document.querySelector(`[data-river-post="${postId}"]`)?.scrollIntoView({ block: 'center' })
    }, 450) // after the Lobby sheet has mounted
  }
})
