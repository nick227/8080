import { useEffect, useRef, useState } from 'react'
import { ApiError, getApiClient, unwrap, useUpdateContact, type Contact, type UpdateContactInput } from '@project/sdk'

export type ContactUndo = { contactId: string; name: string; version: number; patch: UpdateContactInput }
type Job = { patch: UpdateContactInput; resolve: (ok: boolean) => void }
const changesOf = ({ expectedVersion: _version, idempotencyKey: _key, logContact: _log, contactLog: _details, undoLogContact: _undo, ...changes }: UpdateContactInput) => changes
function apply(row: Contact, patch: UpdateContactInput): Contact {
  return { ...row, ...changesOf(patch), fieldValues: { ...row.fieldValues, ...patch.fieldValues } } as Contact
}
function inverse(row: Contact, patch: UpdateContactInput): UpdateContactInput {
  const before: Record<string, unknown> = {}
  for (const key of Object.keys(changesOf(patch))) {
    before[key] = key === 'fieldValues'
      ? Object.fromEntries(Object.keys(patch.fieldValues ?? {}).map(key => [key, row.fieldValues[key] ?? null]))
      : row[key as keyof Contact] ?? null
  }
  if (patch.logContact) {
    before.contacted = row.contacted
    before.lastContactedAt = row.lastContactedAt
    before.undoLogContact = true
  }
  return before as UpdateContactInput
}

/** Serialize edits with the last acknowledged version; preserve every queued draft on failure. */
export function useContactRowEditor(contact: Contact, workspaceId: string, onCommitted: (undo: ContactUndo) => void) {
  const canonical = useRef(contact)
  const queue = useRef<Job[]>([])
  const running = useRef(false)
  const blocked = useRef(false)
  const mounted = useRef(true)
  const commit = useRef(onCommitted)
  commit.current = onCommitted
  const [current, setCurrent] = useState(contact)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [saved, setSaved] = useState(false)
  const update = useUpdateContact(workspaceId)
  const render = () => { if (mounted.current) setCurrent(queue.current.reduce((row, job) => apply(row, job.patch), canonical.current)) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!running.current && contact.version > canonical.current.version) { canonical.current = contact; render() }
  }, [contact])
  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 1800)
    return () => window.clearTimeout(timer)
  }, [saved])
  const drain = async () => {
    if (running.current || blocked.current) return
    running.current = true
    if (mounted.current) { setPending(true); setSaved(false) }
    while (queue.current.length && !blocked.current) {
      const job = queue.current[0]
      const previous = canonical.current
      try {
        const row = await update.mutateAsync({ contactId: previous.id, ...job.patch, expectedVersion: previous.version })
        canonical.current = row
        queue.current.shift()
        commit.current({ contactId: row.id, name: row.displayName, version: row.version, patch: inverse(previous, job.patch) })
        job.resolve(true)
        render()
      } catch (err) {
        blocked.current = true
        if (mounted.current) setError(err instanceof Error ? err : new Error('Could not save. Try again.'))
      }
    }
    running.current = false
    if (mounted.current) { setPending(false); setSaved(!blocked.current) }
  }
  const save = (patch: UpdateContactInput) => new Promise<boolean>(resolve => {
    queue.current.push({ patch: { ...patch, idempotencyKey: patch.idempotencyKey ?? crypto.randomUUID() }, resolve })
    render()
    void drain()
  })
  const reload = async () => {
    setReloading(true)
    try {
      canonical.current = unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}', { params: { path: { workspaceId, contactId: contact.id } } })).data
      render()
      setReviewing(true)
    } catch { setError(new Error('Could not reload. Your edits are still here; try again.')) }
    finally { setReloading(false) }
  }
  const retry = () => {
    // A rejected request has no committed idempotency key. Keep keys on ordinary retries.
    if (reviewing) queue.current.forEach(job => { job.patch.idempotencyKey = crypto.randomUUID() })
    blocked.current = false
    setError(null); setReviewing(false)
    void drain()
  }
  const discard = () => {
    queue.current.forEach(job => job.resolve(false)); queue.current = []
    blocked.current = false; setError(null); setReviewing(false); render()
  }
  const conflict = error instanceof ApiError && error.code === 'CONTACT_VERSION_CONFLICT'
  const draft = queue.current.reduce<UpdateContactInput>((patch, job) => ({ ...patch, ...changesOf(job.patch), fieldValues: { ...patch.fieldValues, ...job.patch.fieldValues } }), {})
  return { current, pending, error, saved, reviewing, reloading, conflict, draft, latest: canonical.current, save, reload, retry, discard }
}
