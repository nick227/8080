import { audienceRules, CONTACT_FOCUSES, CONTACT_SORTS, CONTACT_MILESTONES, type ContactSort } from '@project/shared'
import { ContactTable, ContactUndoBar, type ContactUndo, useContactColumns, readContactPreference, saveContactPreference } from './ContactTable'
import { ContactViewPicker, ContactColumnPicker, ContactFilterChips } from './ContactTableControls'
import { InventoryColumns, InventoryTable, useInventoryTable } from './InventoryTable'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  getApiClient,
  unwrap,
  keys,
  useBulkUpdateContacts,
  useBulkUpdateInventory,
  useContact,
  useContactCounts,
  useContacts,
  useSession,
  useInventory,
  useInventoryCounts,
  useInventoryItem,
  useTags,
  useWorkspaceVocabulary,
  type Contact,
  type InventoryItem,
} from '@project/sdk'
import { useCreateCompany, useCurrentWorkspace } from '../documents/workspace'
import { Composer } from '../compose/Composer'
import { CollectionBar, CollectionHeader } from '../collections/CollectionView'
import { useUrlSearch } from '../collections/table'
import {
  RecordPreviewPanel,
  RecordStepper,
  RecordFormDialog,
  useNarrowRecords,
} from './RecordChrome'
import { RecordDetail } from './RecordDetail'
import { CollectionRow } from './CollectionRow'
import { CollectionToolbar } from './CollectionToolbar'
import { loadLayout, saveLayout, type CollectionLayout } from './collectionLayout'
import { STAGES, titleCase } from './labels'
import { RecordForm } from './RecordForm'
import { RecordImportFlow } from './RecordImportFlow'
import { useRecordNavigation, type RecordKind, type ResultContext } from './navigation'
import './records.css'
import { onCompanyPath } from '../tasks/links'

const positions = new Map<string, number>()

export function RecordsExperience({ kind }: { kind: RecordKind }) {
  const { workspace, loading, guest } = useCurrentWorkspace()
  const { create, creating, createError } = useCreateCompany()
  if (loading)
    return (
      <p className="record-loading" role="status">
        Loading workspace…
      </p>
    )
  if (!workspace)
    return (
      <div className="record-empty">
        <h2>{guest ? 'Sign in to manage your records' : 'Create your company'}</h2>
        {!guest && (
          <button onClick={create} disabled={creating}>
            {creating ? 'Creating…' : 'Create company'}
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const vocabulary = useWorkspaceVocabulary(workspaceId)
  const tags = useTags(workspaceId)
  const stageOptions = useMemo(
    () => (vocabulary.data?.stages ?? []).filter((s) => !s.archived).map((s) => ({ key: s.key, label: s.label })),
    [vocabulary.data?.stages],
  )
  const inventoryCategories = vocabulary.data?.categories ?? []
  const contactTags = tags.data ?? []
  const q = nav.params.get('q') ?? ''
  const stageParam = nav.params.get('stage')
  const stage = stageParam && /^[a-z][a-z0-9_-]{0,63}$/i.test(stageParam) ? stageParam : undefined
  const tagId = nav.params.get('tag') || undefined
  const archived = nav.params.get('status') === 'archived'
  const focus = nav.params.get('focus') ?? ''
  const session = useSession()
  const preferenceKey = `contacts:${workspaceId}:${session.data?.data.id ?? 'pending'}`
  const [columns, setColumns] = useContactColumns(preferenceKey)
  const [undo, setUndo] = useState<ContactUndo | null>(null)
  const savedSort = readContactPreference<{ sort?: string; dir?: string; thenSort?: string; thenDir?: string }>(`${preferenceKey}:sort`, {})
  const sort = nav.params.get('sort') ?? (kind === 'contacts' ? savedSort.sort ?? 'followUp' : 'name')
  const dir = (nav.params.get('dir') ?? (kind === 'contacts' ? savedSort.dir : 'asc')) === 'desc' ? 'desc' : 'asc'
  const thenSort = nav.params.has('thenSort') ? nav.params.get('thenSort') ?? '' : kind === 'contacts' ? savedSort.thenSort ?? '' : ''
  const thenDir = (nav.params.get('thenDir') ?? savedSort.thenDir) === 'desc' ? 'desc' : 'asc'
  const tableParams = new URLSearchParams(nav.params)
  tableParams.set('sort', sort)
  tableParams.set('dir', dir)
  if (thenSort) tableParams.set('thenSort', thenSort)
  tableParams.set('thenDir', thenDir)
  let audienceSummary = 'Automation audience rules active'
  try { const audience = JSON.parse(nav.params.get('audience') || 'null'); audienceSummary = audienceRules(audience).map(r => r.label).join(' AND ') || audienceSummary } catch { /* The API reports malformed audience rules. */ }
  const contactParams = {
    audience: nav.params.get('audience') || undefined,
    q: q.trim() || undefined,
    leadStatus: stage,
    tagId,
    status: (archived ? 'archived' : 'active') as 'active' | 'archived',
    focus: !archived && CONTACT_FOCUSES.includes(focus as typeof CONTACT_FOCUSES[number]) ? focus as typeof CONTACT_FOCUSES[number] : undefined,
    ownerMemberId: nav.params.get('owner') || undefined,
    milestone: CONTACT_MILESTONES.includes(nav.params.get('milestone') as typeof CONTACT_MILESTONES[number]) ? nav.params.get('milestone') as typeof CONTACT_MILESTONES[number] : undefined,
    checked: nav.params.get('checked') === 'true',
    thenSort: CONTACT_SORTS.includes(thenSort as ContactSort) ? thenSort as ContactSort : undefined,
    thenDir: thenDir as 'asc' | 'desc',
    sort: CONTACT_SORTS.includes(sort as ContactSort)
      ? sort as ContactSort
      : undefined,
    dir: dir as 'asc' | 'desc',
  }
  const stockParam = nav.params.get('stock')
  const categoryParam = nav.params.get('category') || undefined
  const inventoryFocus =
    !archived && ['offered', 'paused', 'out', 'low'].includes(focus)
      ? (focus as 'offered' | 'paused' | 'out' | 'low')
      : !archived && stockParam === 'low'
        ? ('low' as const)
        : undefined
  const inventoryParams = {
    q: q.trim() || undefined,
    status: (archived ? 'archived' : 'active') as 'active' | 'archived',
    focus: inventoryFocus,
    category: categoryParam,
    sort: ['name', 'price', 'updated', 'quantity'].includes(sort)
      ? (sort as 'name' | 'price' | 'updated' | 'quantity')
      : undefined,
    dir: dir as 'asc' | 'desc',
  }
  const contacts = useContacts(kind === 'contacts' ? workspaceId : undefined, contactParams)
  const inventory = useInventory(kind === 'inventory' ? workspaceId : undefined, inventoryParams)
  const contactCounts = useContactCounts(kind === 'contacts' ? workspaceId : undefined)
  const inventoryCounts = useInventoryCounts(kind === 'inventory' ? workspaceId : undefined)
  const bulkContacts = useBulkUpdateContacts(workspaceId)
  const bulkInventory = useBulkUpdateInventory(workspaceId)
  const list = kind === 'contacts' ? contacts : inventory
  const counts = kind === 'contacts' ? contactCounts.data : inventoryCounts.data
  const records: (Contact | InventoryItem)[] = useMemo(
    () => list.data?.pages.flatMap((page) => page.data as (Contact | InventoryItem)[]) ?? [],
    [list.data?.pages],
  )
  const total = list.data?.pages[0]?.meta.total
  const [selected, setSelected] = useState<string[]>([])
  const [bulkError, setBulkError] = useState('')
  const [layout, setLayout] = useState<CollectionLayout>(() => loadLayout(workspaceId, kind))
  useEffect(() => {
    setLayout(loadLayout(workspaceId, kind))
  }, [workspaceId, kind])
  const chooseLayout = (next: CollectionLayout) => {
    setLayout(next)
    saveLayout(workspaceId, kind, next)
  }
  useEffect(() => {
    setSelected([])
    setBulkError('')
  }, [kind, q, stage, tagId, categoryParam, archived, focus, sort, dir, thenSort, thenDir, nav.params.get('owner'), nav.params.get('milestone'), nav.params.get('checked')])
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
  const [importing, setImporting] = useState(false)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const label = `${archived ? 'Archived' : stage && kind === 'contacts' ? titleCase(stage) : 'All'} ${kind}`
  // Search lives in the shared collection bar (redesign D9); a new search closes an open record.
  const clearRecord = useCallback((next: URLSearchParams) => {
    if (kind === 'contacts') { next.delete('record'); next.delete('preview'); next.delete('previewKind') }
  }, [kind])
  const search = useUrlSearch(clearRecord)
  const inventoryTable = useInventoryTable({
    workspaceId, currency, href: nav.href, sort, dir,
    onOpen: (id) => nav.open(id, context(id)),
    onPreview: (id, name) => nav.preview({ kind: 'inventory', id, name }, context(id)),
    onSort: (next) => filters({ sort: next, dir: next === sort && dir === 'asc' ? 'desc' : 'asc' }),
  })
  const toolbar = (part: 'filters' | 'view' | 'bulk') => (
    <CollectionToolbar
      part={part}
              kind={kind}
              archived={archived}
              focus={focus}
              sort={sort}
              dir={dir}
              stage={stage}
              stages={stageOptions.length ? stageOptions : undefined}
              categories={inventoryCategories}
              category={categoryParam}
              tags={contactTags}
              tagId={tagId}
              layout={layout}
              counts={counts}
              selectedCount={selected.length}
              matchingTotal={typeof total === 'number' ? total : undefined}
              onFilter={filter}
              onFilters={filters}
              onLayout={chooseLayout}
              onBulk={(action, extra) => void runBulk(action, extra)}
              contactViewPicker={
                kind === 'contacts' ? (
                  <ContactViewPicker
                    workspaceId={workspaceId}
                    preferenceKey={preferenceKey}
                    params={tableParams}
                    columns={columns}
                    onColumns={setColumns}
                    onFilters={filters}
                    layout={layout}
                    onLayout={chooseLayout}
                  />
                ) : undefined
              }
              contactColumnPicker={
                kind === 'contacts' ? (
                  <ContactColumnPicker
                    workspaceId={workspaceId}
                    columns={columns}
                    onColumns={setColumns}
                    layout={layout}
                    onLayout={chooseLayout}
                  />
                ) : undefined
              }
              filterChips={
                kind === 'contacts' ? (
                  <ContactFilterChips params={tableParams} onFilters={filters} />
                ) : undefined
              }
    />
  )
  const browseParams = new URLSearchParams(location.search)
  browseParams.delete('record')
  browseParams.delete('preview')
  browseParams.delete('previewKind')
  // Same-desk links: company paths carry the desk in the path (a ?desk= would redirect and remount).
  if (onCompanyPath(location.pathname)) browseParams.delete('desk')
  else browseParams.set('desk', kind)
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
    if (onCompanyPath(location.pathname)) params.delete('desk')
    else params.set('desk', kind)
    if (q.trim()) params.set('q', q.trim())
    else params.delete('q')
    return {
      kind,
      ids: records.map((record) => record.id),
      complete: !list.hasNextPage,
      label: q.trim() ? `Search “${q.trim()}”` : label,
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
      const existingSet = new Set(results.ids)
      while (
        !response.isError &&
        response.hasNextPage &&
        response.data?.pages.every((page) => page.data.every((record) => existingSet.has(record.id)))
      ) {
        response = await list.fetchNextPage()
      }
      if (response.isError) throw response.error
      const ids = response.data?.pages.flatMap((page) => page.data.map((record) => record.id)) ?? []
      const extra = ids.filter((id) => !existingSet.has(id))
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
  const filter = (key: string, value: string) => filters({ [key]: value })
  const filters = (patch: Record<string, string>) => {
    if (kind === 'contacts') {
      const sorting = { sort, dir, thenSort, thenDir, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['sort', 'dir', 'thenSort', 'thenDir'].includes(key))) }
      saveContactPreference(`${preferenceKey}:sort`, sorting)
      // Pin remembered sorting into the URL whenever this view changes.
      patch = { ...sorting, ...patch }
    }
    positions.set(positionKey, browsePosition.current)
    restored.current = false
    nav.setFilters(patch)
  }
  const runBulk = async (action: string, extra: Record<string, string | boolean> = {}) => {
    if (!selected.length) return
    setBulkError('')
    try {
      if (kind === 'contacts') {
        await bulkContacts.mutateAsync({
          ids: selected,
          action: action as 'archive' | 'restore' | 'setStage',
          leadStatus: typeof extra.leadStatus === 'string' ? extra.leadStatus : undefined,
        })
      } else {
        await bulkInventory.mutateAsync({
          ids: selected,
          action: action as 'archive' | 'restore' | 'setAvailability',
          availability: typeof extra.availability === 'boolean' ? extra.availability : undefined,
        })
      }
      setSelected([])
    } catch {
      setBulkError('Could not update the selected records. Try again.')
    }
  }
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
              onDeleted={nav.back}
              onOpenRecord={(target, id) => nav.open(id)}
            />
          </>
        ) : (
          <>
            <CollectionHeader
              collection={kind}
              count={typeof total === 'number' ? total : undefined}
              onNew={() => setAdding(true)}
              actions={<button type="button" className="section-add-btn" onClick={() => setImporting(true)}>Import</button>}
            />
            <CollectionBar
              collection={kind}
              search={{ value: search.value, onChange: search.setValue, placeholder: kind === 'contacts' ? 'Search contacts, companies, interests…' : 'Search inventory…' }}
              filters={toolbar('filters')}
              view={<>{toolbar('view')}{kind === 'inventory' && layout === 'list' && <InventoryColumns table={inventoryTable} />}</>}
            />
            {toolbar('bulk')}
            {kind === 'contacts' && selected.length > 0 && <button type="button" className="agents-button" onClick={() => navigate({ search: new URLSearchParams({ desk: 'agents', add: '1', contactIds: selected.join(',') }).toString() })}>New automation for {selected.length} selected {selected.length === 1 ? 'contact' : 'contacts'}</button>}
            {kind === 'contacts' && nav.params.get('audience') && <div className="audience-chips"><span>{audienceSummary}</span><button type="button" onClick={() => nav.setFilter('audience', '')}>Clear audience</button></div>}
            {kind === 'contacts' && <ContactUndoBar workspaceId={workspaceId} undo={undo} onDismiss={() => setUndo(null)} />}
            {bulkError && (
              <p role="alert" className="record-error">
                {bulkError}
              </p>
            )}
            {/* The header shows the count; here only what it can't: updating, or how many are loaded so far. */}
            <p className="record-count" role="status">
              {list.isFetching && !list.isFetchingNextPage
                ? 'Updating…'
                : list.hasNextPage ? `${records.length} loaded${typeof total === 'number' ? ` of ${total}` : ''}` : ''}
            </p>
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
                  {q || focus || stage || tagId || categoryParam || nav.params.get('owner') || nav.params.get('milestone')
                    ? 'No matching records'
                    : archived
                      ? 'Nothing archived'
                      : `Your ${kind === 'contacts' ? 'relationships' : 'catalog'} start here`}
                </h2>
                <p>
                  {q || focus || stage || tagId || categoryParam || nav.params.get('owner') || nav.params.get('milestone')
                    ? 'Try another search or clear your filters.'
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
            ) : kind === 'contacts' && layout === 'list' ? (
              <ContactTable onCommitted={setUndo} workspaceId={workspaceId} currency={currency} records={records as Contact[]} columns={columns} selected={selected}
                sort={sort} dir={dir} onSort={next => filters({ sort: next, dir: next === sort && dir === 'asc' ? 'desc' : 'asc' })}
                onSelect={setSelected} onToggle={id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
                href={nav.href} onOpen={id => nav.open(id, context(id))} previewId={nav.previewId}
                onPreview={(id, name) => nav.preview({ kind, id, name }, context(id))} />
            ) : kind === 'inventory' && layout === 'list' ? (
              <InventoryTable table={inventoryTable} workspaceId={workspaceId} currency={currency} records={records as InventoryItem[]} selected={selected}
                sort={sort} dir={dir} onSort={next => filters({ sort: next, dir: next === sort && dir === 'asc' ? 'desc' : 'asc' })}
                onSelect={setSelected} onToggle={id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
                href={nav.href} onOpen={id => nav.open(id, context(id))} previewId={nav.previewId}
                onPreview={(id, name) => nav.preview({ kind: 'inventory', id, name }, context(id))} />
            ) : (
              <ul
                className={`record-collection record-${layout}`}
                aria-label={`${title} results`}
                onKeyDown={(event) => {
                  if (
                    !(event.target instanceof HTMLElement) ||
                    !event.target.matches('[data-record-link]')
                  )
                    return
                  const keys =
                    layout === 'grid'
                      ? ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']
                      : ['ArrowDown', 'ArrowUp']
                  if (!keys.includes(event.key)) return
                  const links = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>('[data-record-link]'),
                  )
                  const index = links.indexOf(event.target)
                  const step =
                    event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
                  event.preventDefault()
                  links[index + step]?.focus()
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
                      checked={selected.includes(record.id)}
                      href={nav.href(record.id)}
                      onOpen={(id) => nav.open(id, context(id))}
                      onPreview={(id, label) => nav.preview({ kind, id, name: label }, context(id))}
                      onToggle={(id) =>
                        setSelected((current) =>
                          current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
                        )
                      }
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
      {importing && (
        <RecordImportFlow kind={kind} workspaceId={workspaceId} onClose={() => setImporting(false)} />
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
