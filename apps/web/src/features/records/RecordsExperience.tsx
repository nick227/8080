import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  getApiClient,
  unwrap,
  keys,
  useContact,
  useContacts,
  useInventory,
  useInventoryItem,
  type Contact,
  type InventoryItem,
  type LeadStatus,
} from '@project/sdk'
import { useCurrentWorkspace } from '../documents/workspace'
import { Composer } from '../compose/Composer'
import {
  RecordPreviewPanel,
  RecordStepper,
  RecordFormDialog,
  useNarrowRecords,
} from './RecordChrome'
import { RecordDetail } from './RecordDetail'
import { CollectionRow } from './CollectionRow'
import { STAGES, titleCase } from './labels'
import { RecordForm } from './RecordForm'
import { useRecordNavigation, type RecordKind, type ResultContext } from './navigation'
import './records.css'

const positions = new Map<string, number>()

export function RecordsExperience({ kind }: { kind: RecordKind }) {
  const { workspace, loading, guest, create, creating, createError } = useCurrentWorkspace()
  if (loading)
    return (
      <p className="record-loading" role="status">
        Loading workspace…
      </p>
    )
  if (!workspace)
    return (
      <div className="record-empty">
        <h2>{guest ? 'Sign in to manage your records' : 'Create your workspace'}</h2>
        {!guest && (
          <button onClick={create} disabled={creating}>
            {creating ? 'Creating…' : 'Create workspace'}
          </button>
        )}
        {createError && <p role="alert">{createError}</p>}
      </div>
    )
  return (
    <RecordWorkspace
      key={`${workspace.id}:${kind}`}
      kind={kind}
      workspaceId={workspace.id}
      currency={workspace.defaultCurrency || 'USD'}
    />
  )
}

function RecordWorkspace({
  kind,
  workspaceId,
  currency,
}: {
  kind: RecordKind
  workspaceId: string
  currency: string
}) {
  const nav = useRecordNavigation(kind)
  const container = useRef<HTMLDivElement>(null)
  const narrow = useNarrowRecords(container)
  const location = useLocation()
  const queryClient = useQueryClient()
  const q = nav.params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  useEffect(() => setSearch(q), [q])
  const stage = STAGES.includes(nav.params.get('stage') as LeadStatus)
    ? (nav.params.get('stage') as LeadStatus)
    : undefined
  const archived = nav.params.get('status') === 'archived'
  const view =
    nav.params.get('view') === 'list'
      ? 'list'
      : nav.params.get('view') === 'grid'
        ? 'grid'
        : kind === 'contacts'
          ? 'list'
          : 'grid'
  const contacts = useContacts(kind === 'contacts' ? workspaceId : undefined, {
    q: q.trim() || undefined,
    leadStatus: stage,
    status: archived ? 'archived' : 'active',
  })
  const inventory = useInventory(kind === 'inventory' ? workspaceId : undefined, {
    q: q.trim() || undefined,
    status: archived ? 'archived' : 'active',
  })
  const list = kind === 'contacts' ? contacts : inventory
  const records: (Contact | InventoryItem)[] =
    list.data?.pages.flatMap((page) => page.data as (Contact | InventoryItem)[]) ?? []
  const currentContact = useContact(
    kind === 'contacts' && nav.recordId ? workspaceId : undefined,
    nav.recordId ?? undefined,
  )
  const currentItem = useInventoryItem(
    kind === 'inventory' && nav.recordId ? workspaceId : undefined,
    nav.recordId ?? undefined,
  )
  const fullName = currentContact.data?.displayName ?? currentItem.data?.name ?? titleCase(kind)
  const [adding, setAdding] = useState(false)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const label = `${archived ? 'Archived' : stage && kind === 'contacts' ? titleCase(stage) : 'All'} ${kind}`
  const browseParams = new URLSearchParams(location.search)
  browseParams.delete('record')
  browseParams.delete('preview')
  browseParams.delete('previewKind')
  browseParams.set('desk', kind)
  const browseSearch = `?${browseParams}`
  const positionKey = `${workspaceId}:${location.pathname}:${browseSearch}`
  const browsePosition = useRef(positions.get(positionKey) ?? 0)
  const restored = useRef(false)
  const hadRecord = useRef(!!nav.recordId)
  const previousRecord = useRef(nav.recordId)
  const restoringPages =
    !nav.recordId &&
    !list.isError &&
    nav.state.results?.search === browseSearch &&
    records.length < nav.state.results.ids.length &&
    !!list.hasNextPage
  useEffect(() => {
    // History survives a reload; the query cache may not. Rebuild the loaded
    // portion before restoring a row and scroll offset beyond the first page.
    if (restoringPages && !list.isFetching) void list.fetchNextPage()
  }, [restoringPages, list.isFetching, list.fetchNextPage])

  useLayoutEffect(() => {
    if (nav.recordId) {
      if (nav.recordId !== previousRecord.current || !hadRecord.current) {
        scroller.current?.scrollTo(0, 0)
        heading.current?.focus({ preventScroll: true })
      }
      hadRecord.current = true
      previousRecord.current = nav.recordId
      restored.current = false
      return
    }
    if (restored.current || list.isLoading || restoringPages) return
    const resultScroll = nav.state.results?.search === browseSearch ? nav.state.results.scroll : undefined
    const top = resultScroll ?? positions.get(positionKey) ?? 0
    scroller.current?.scrollTo(0, top)
    browsePosition.current = top
    if (hadRecord.current) {
      const target = nav.state.results?.focusId
      const node = Array.from(
        scroller.current?.querySelectorAll<HTMLElement>('[data-record-link]') ?? [],
      ).find((el) => el.dataset.recordLink === target)
      node?.focus({ preventScroll: true })
    }
    hadRecord.current = false
    previousRecord.current = null
    restored.current = true
  }, [
    nav.recordId,
    list.isLoading,
    records.length,
    positionKey,
    browseSearch,
    nav.state.results,
    restoringPages,
  ])

  useEffect(() => {
    restored.current = false
  }, [positionKey])
  const context = (id: string): ResultContext => {
    const params = new URLSearchParams(location.search)
    params.delete('record')
    params.delete('preview')
    params.delete('previewKind')
    params.set('desk', kind)
    if (search.trim()) params.set('q', search.trim())
    else params.delete('q')
    return {
      kind,
      ids: records.map((record) => record.id),
      complete: !list.hasNextPage,
      label: search.trim() ? `Search “${search.trim()}”` : label,
      search: `?${params}`,
      scroll: scroller.current?.scrollTop ?? 0,
      focusId: id,
    }
  }
  const results = nav.state.results?.kind === kind ? nav.state.results : undefined
  const activeId = nav.previewId && nav.previewKind === kind ? nav.previewId : nav.recordId
  const activeIndex = results && activeId ? results.ids.indexOf(activeId) : -1
  const nextId = results?.ids[activeIndex + 1]
  useEffect(() => {
    if (!nextId || activeIndex < 0) return
    if (kind === 'contacts')
      void queryClient.prefetchQuery({
        queryKey: keys.contact(workspaceId, nextId),
        queryFn: async () =>
          unwrap(
            await getApiClient().GET('/workspaces/{workspaceId}/contacts/{contactId}', {
              params: { path: { workspaceId, contactId: nextId } },
            }),
          ).data,
        staleTime: 30_000,
      })
    else
      void queryClient.prefetchQuery({
        queryKey: keys.inventoryItem(workspaceId, nextId),
        queryFn: async () =>
          unwrap(
            await getApiClient().GET('/workspaces/{workspaceId}/inventory/{inventoryId}', {
              params: { path: { workspaceId, inventoryId: nextId } },
            }),
          ).data,
        staleTime: 30_000,
      })
  }, [nextId, activeIndex, kind, workspaceId, queryClient])

  const step = (id: string, preview: boolean) => {
    if (results) {
      setNavigationError('')
      nav.step(id, preview, { ...results, focusId: id })
    }
  }
  const loadNext = async (preview: boolean) => {
    if (!results) return
    setNavigationError('')
    try {
      let response = await list.fetchNextPage()
      while (
        !response.isError &&
        response.hasNextPage &&
        response.data?.pages.every((page) => page.data.every((record) => results.ids.includes(record.id)))
      ) {
        response = await list.fetchNextPage()
      }
      if (response.isError) throw response.error
      const ids = response.data?.pages.flatMap((page) => page.data.map((record) => record.id)) ?? []
      const extra = ids.filter((id) => !results.ids.includes(id))
      const combined = { ...results, ids: [...results.ids, ...extra], complete: !response.hasNextPage }
      if (extra[0]) nav.step(extra[0], preview, { ...combined, focusId: extra[0] })
      else nav.updateResults(combined)
    } catch {
      setNavigationError('Could not load the next records. Try again.')
    }
  }
  const stepper = (id: string, preview: boolean) => (
    <RecordStepper
      id={id}
      results={results}
      busy={list.isFetchingNextPage}
      hasMore={!!list.hasNextPage}
      onStep={(next) => step(next, preview)}
      onLoad={() => loadNext(preview)}
    />
  )
  const filter = (key: string, value: string) => {
    positions.set(positionKey, browsePosition.current)
    restored.current = false
    nav.setFilter(key, value)
  }
  useEffect(() => {
    if (nav.recordId || search === q) return
    const timer = window.setTimeout(() => filter('q', search), 200)
    return () => window.clearTimeout(timer)
  }, [search, q, nav.recordId])
  const title = kind === 'contacts' ? 'Contacts' : 'Inventory'
  const previewRef = nav.state.trail?.at(-1)
  const previewTitle = previewRef?.name ?? titleCase(nav.previewKind)

  return (
    <div className="records-experience" ref={container}>
      <div
        className="records-scroll"
        inert={!!nav.previewId && narrow}
        ref={scroller}
        onScroll={(event) => {
          if (!nav.recordId) {
            browsePosition.current = event.currentTarget.scrollTop
            positions.set(positionKey, event.currentTarget.scrollTop)
          }
        }}
      >
        {nav.recordId ? (
          <>
            <div className="record-navigation">
              <button onClick={nav.back}>
                ← {nav.state.origin?.name ?? results?.label ?? `All ${kind}`}
              </button>
              {stepper(nav.recordId, false)}
            </div>
            <h2 className="record-sr-only" ref={heading} tabIndex={-1}>
              Record details
            </h2>
            {navigationError && (
              <p role="alert" className="record-error">
                {navigationError}
              </p>
            )}
            <RecordDetail
              kind={kind}
              id={nav.recordId}
              workspaceId={workspaceId}
              currency={currency}
              onMessage={setMessageId}
              onRelated={nav.preview}
              onDeleted={nav.back}
              onOpenRecord={(target, id) => nav.open(id)}
            />
          </>
        ) : (
          <>
            <header className="record-collection-header">
              <div>
                <span className="record-eyebrow">Workspace / {title}</span>
                <h1>{title}</h1>
                <p>
                  {kind === 'contacts'
                    ? 'People, relationships, and the next conversation.'
                    : 'What you offer, all in one place.'}
                </p>
              </div>
              <button className="record-primary" onClick={() => setAdding(true)}>
                + Add {kind === 'contacts' ? 'contact' : 'item'}
              </button>
            </header>
            <div className="record-collection-tools">
              <label className="record-search">
                <span className="record-sr-only">Search {kind}</span>
                <input
                  type="search"
                  placeholder={kind === 'contacts' ? 'Search contacts…' : 'Search name or SKU…'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {kind === 'contacts' && (
                <select
                  aria-label="Filter by lead stage"
                  value={stage ?? ''}
                  onChange={(e) => filter('stage', e.target.value)}
                >
                  <option value="">All stages</option>
                  {STAGES.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </select>
              )}
              <div className="record-view-switch" aria-label="Collection view">
                <button aria-pressed={view === 'list'} onClick={() => filter('view', 'list')}>
                  List
                </button>
                <button aria-pressed={view === 'grid'} onClick={() => filter('view', 'grid')}>
                  Grid
                </button>
              </div>
            </div>
            <div className="record-collection-views">
              <div>
                <button aria-pressed={!archived} onClick={() => filter('status', 'active')}>
                  All {kind}
                </button>
                <button aria-pressed={archived} onClick={() => filter('status', 'archived')}>
                  Archived
                </button>
              </div>
              <span role="status">
                {list.isFetching && !list.isFetchingNextPage
                  ? 'Updating…'
                  : `${records.length}${list.hasNextPage ? '+' : ''} ${records.length === 1 ? 'record' : 'records'}${list.hasNextPage ? ' loaded' : ''}`}
              </span>
            </div>
            {list.isError ? (
              <div className="record-empty" role="alert">
                <h2>Could not load {kind}</h2>
                <button onClick={() => list.refetch()}>Try again</button>
              </div>
            ) : list.isLoading ? (
              <div className="record-loading" role="status">
                Loading {kind}…
              </div>
            ) : records.length === 0 ? (
              <div className="record-empty">
                <h2>
                  {q
                    ? 'No matching records'
                    : archived
                      ? 'Nothing archived'
                      : `Your ${kind === 'contacts' ? 'relationships' : 'catalog'} start here`}
                </h2>
                <p>
                  {q
                    ? 'Try another name or clear your search.'
                    : archived
                      ? 'Archived records will appear here.'
                      : `Add your first ${kind === 'contacts' ? 'contact' : 'item'} to get started.`}
                </p>
                {q ? (
                  <button onClick={() => filter('q', '')}>Clear search</button>
                ) : (
                  !archived && (
                    <button onClick={() => setAdding(true)}>
                      Add {kind === 'contacts' ? 'contact' : 'item'}
                    </button>
                  )
                )}
              </div>
            ) : (
              <ul
                className={`record-collection record-${view}`}
                aria-label={`${title} results`}
                onKeyDown={(event) => {
                  if (
                    !(event.target instanceof HTMLElement) ||
                    !event.target.matches('[data-record-link]') ||
                    !['ArrowDown', 'ArrowUp'].includes(event.key)
                  )
                    return
                  const links = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>('[data-record-link]'),
                  )
                  const index = links.indexOf(event.target)
                  event.preventDefault()
                  links[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
                }}
              >
                {records.map((record) => {
                  const name = 'displayName' in record ? record.displayName : record.name
                  return (
                    <CollectionRow
                      key={record.id}
                      record={record}
                      kind={kind}
                      workspaceId={workspaceId}
                      currency={currency}
                      selected={nav.previewKind === kind && nav.previewId === record.id}
                      href={nav.href(record.id)}
                      onOpen={(id) => nav.open(id, context(id))}
                      onPreview={(id, name) => nav.preview({ kind, id, name }, context(id))}
                    />
                  )
                })}
              </ul>
            )}
            {list.hasNextPage && (
              <div className="record-load-more">
                <button disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more records'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {nav.previewId && (
        <RecordPreviewPanel
          recordKey={`${nav.previewKind}:${nav.previewId}`}
          narrow={narrow}
          title={previewTitle}
          onClose={nav.closePreview}
          onExpand={() =>
            nav.expand({ kind: nav.previewKind, id: nav.previewId!, name: previewTitle }, fullName)
          }
          onBack={(nav.state.trail?.length ?? 0) > 1 ? nav.previewBack : undefined}
          backLabel={nav.state.trail?.at(-2)?.name}
          navigation={
            nav.previewKind === kind && (nav.state.trail?.length ?? 0) <= 1
              ? stepper(nav.previewId, true)
              : undefined
          }
        >
          {navigationError && (
            <p className="record-error" role="alert">
              {navigationError}
            </p>
          )}
          <RecordDetail
            kind={nav.previewKind}
            id={nav.previewId}
            workspaceId={workspaceId}
            currency={currency}
            onMessage={setMessageId}
            onRelated={nav.related}
            onDeleted={nav.closePreview}
            onOpenRecord={(target, id) => {
              if (target === kind) nav.open(id)
              else nav.expand({ kind: target, id, name: titleCase(target) }, fullName)
            }}
          />
        </RecordPreviewPanel>
      )}
      {adding && (
        <RecordForm
          kind={kind}
          workspaceId={workspaceId}
          currency={currency}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false)
            nav.open(id)
          }}
          onOpenRecord={(target, id) => {
            setAdding(false)
            if (target === kind) nav.open(id)
            else nav.expand({ kind: target, id, name: titleCase(target) }, fullName)
          }}
        />
      )}
      {messageId && (
        <RecordFormDialog title="Message contact" onClose={() => setMessageId(null)}>
          <Composer
            workspaceId={workspaceId}
            contactId={messageId}
            contextType="contact"
            contextId={messageId}
            onClose={() => setMessageId(null)}
          />
        </RecordFormDialog>
      )}
    </div>
  )
}
