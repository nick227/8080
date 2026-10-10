import { useState } from 'react'
import {
  useCreateCategory,
  useCreateTag,
  useDeleteCategory,
  useRenameCategory,
  useTags,
  useUpdatePipeline,
  useUpdateTag,
  useWorkspaceVocabulary,
} from '@project/sdk'
import { SectionHeader } from '../work/SectionHeader'

type StageDraft = {
  id: string
  key: string
  label: string
  position: number
  kind: 'open' | 'won' | 'lost'
  archived: boolean
  system: boolean
}

export function VocabularySection({
  workspaceId,
  canEdit,
  inSlideout = false,
}: {
  workspaceId: string
  canEdit: boolean
  inSlideout?: boolean
}) {
  const vocab = useWorkspaceVocabulary(workspaceId)
  const updatePipeline = useUpdatePipeline(workspaceId)
  const createCategory = useCreateCategory(workspaceId)
  const renameCategory = useRenameCategory(workspaceId)
  const deleteCategory = useDeleteCategory(workspaceId)
  const tags = useTags(workspaceId)
  const createTag = useCreateTag(workspaceId)
  const updateTag = useUpdateTag(workspaceId)
  const [status, setStatus] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newTag, setNewTag] = useState('')
  const data = vocab.data
  const active = (data?.stages ?? []).filter((s) => !s.archived)

  const note = (ok: string, err: unknown) => setStatus(err instanceof Error ? err.message : ok)

  const saveStages = async (stages: StageDraft[]) => {
    if (!canEdit) return
    setStatus('Saving…')
    try {
      await updatePipeline.mutateAsync({
        stages: stages.map((s, i) => ({
          id: s.id || undefined,
          key: s.key,
          label: s.label,
          position: i,
          kind: s.kind,
          archived: s.archived,
        })),
      })
      setStatus('Saved.')
    } catch (e) {
      note('Saved.', e)
    }
  }

  const content = !data ? (
    <p className="company-status" role="status" style={inSlideout ? { padding: 'var(--space-lg)' } : undefined}>
      {vocab.isError ? 'Couldn’t load vocabulary.' : 'Loading…'}
    </p>
  ) : (
    <div className="company-vocab" style={inSlideout ? { padding: 'var(--space-lg)' } : undefined}>
          <div className="company-vocab-block">
            <h3>Pipeline stages</h3>
            <ul className="company-vocab-list">
              {active.map((stage) => (
                <li key={stage.id} className="company-vocab-row">
                  {canEdit ? (
                    <input
                      className="company-vocab-input"
                      defaultValue={stage.label}
                      maxLength={80}
                      aria-label={`Stage ${stage.label}`}
                      onBlur={(e) => {
                        const label = e.target.value.trim()
                        if (!label || label === stage.label) return
                        void saveStages(active.map((s) => (s.id === stage.id ? { ...s, label } : s)))
                      }}
                    />
                  ) : (
                    <span className="company-vocab-text">{stage.label}</span>
                  )}
                  <span className="company-vocab-meta">{stage.kind}</span>
                  {canEdit && active.length > 1 && (
                    <button
                      type="button"
                      className="section-add-btn"
                      onClick={() => {
                        if (!window.confirm(`Remove stage “${stage.label}”?`)) return
                        void saveStages(active.filter((s) => s.id !== stage.id))
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <button
                type="button"
                className="section-add-btn"
                onClick={() => {
                  const key = `stage_${Math.random().toString(36).slice(2, 8)}`
                  void saveStages([
                    ...active,
                    { id: '', key, label: 'New stage', position: active.length, kind: 'open', archived: false, system: false },
                  ])
                }}
              >
                + Add stage
              </button>
            )}
          </div>

          <div className="company-vocab-block">
            <h3>Inventory categories</h3>
            <ul className="company-vocab-list">
              {data.categories.map((cat) => (
                <li key={cat} className="company-vocab-row">
                  {canEdit ? (
                    <input
                      className="company-vocab-input"
                      defaultValue={cat}
                      maxLength={80}
                      aria-label={`Category ${cat}`}
                      onBlur={(e) => {
                        const to = e.target.value.trim()
                        if (!to || to === cat) return
                        setStatus('Saving…')
                        void renameCategory.mutateAsync({ from: cat, to }).then(
                          () => setStatus('Saved.'),
                          (err: unknown) => note('Saved.', err),
                        )
                      }}
                    />
                  ) : (
                    <span className="company-vocab-text">{cat}</span>
                  )}
                  <span className="company-vocab-meta" aria-hidden />
                  {canEdit && (
                    <button
                      type="button"
                      className="section-add-btn"
                      onClick={() => {
                        if (!window.confirm(`Remove “${cat}” from vocabulary and clear it on items?`)) return
                        setStatus('Removing…')
                        void deleteCategory.mutateAsync({ name: cat }).then(
                          () => setStatus('Removed.'),
                          (err: unknown) => note('Removed.', err),
                        )
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="company-vocab-add">
                <input
                  className="company-vocab-input"
                  value={newCategory}
                  maxLength={80}
                  placeholder="New category"
                  aria-label="New inventory category"
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const name = newCategory.trim()
                    if (!name) return
                    setStatus('Saving…')
                    void createCategory.mutateAsync({ name }).then(
                      () => {
                        setNewCategory('')
                        setStatus('Saved.')
                      },
                      (err: unknown) => note('Saved.', err),
                    )
                  }}
                />
                <button
                  type="button"
                  className="section-add-btn"
                  disabled={!newCategory.trim() || createCategory.isPending}
                  onClick={() => {
                    const name = newCategory.trim()
                    if (!name) return
                    setStatus('Saving…')
                    void createCategory.mutateAsync({ name }).then(
                      () => {
                        setNewCategory('')
                        setStatus('Saved.')
                      },
                      (err: unknown) => note('Saved.', err),
                    )
                  }}
                >
                  + Add
                </button>
              </div>
            )}
          </div>

          <div className="company-vocab-block">
            <h3>Contact categories</h3>
            {tags.isError ? (
              <p className="company-quiet">Couldn’t load contact categories.</p>
            ) : (
              <ul className="company-vocab-list">
                {(tags.data ?? []).map((tag) => (
                  <li key={tag.id} className="company-vocab-row">
                    {canEdit ? (
                      <input
                        className="company-vocab-input"
                        defaultValue={tag.name}
                        maxLength={40}
                        aria-label={`Contact category ${tag.name}`}
                        onBlur={(e) => {
                          const name = e.target.value.trim()
                          if (!name || name === tag.name) return
                          setStatus('Saving…')
                          void updateTag.mutateAsync({ tagId: tag.id, name }).then(
                            () => setStatus('Saved.'),
                            (err: unknown) => note('Saved.', err),
                          )
                        }}
                      />
                    ) : (
                      <span className="company-vocab-text">{tag.name}</span>
                    )}
                    <span className="company-vocab-meta" aria-hidden />
                    {canEdit && (
                      <button
                        type="button"
                        className="section-add-btn"
                        onClick={() => {
                          if (!window.confirm(`Remove “${tag.name}” from every contact?`)) return
                          setStatus('Removing…')
                          void updateTag.mutateAsync({ tagId: tag.id, remove: true }).then(
                            () => setStatus('Removed.'),
                            (err: unknown) => note('Removed.', err),
                          )
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="company-vocab-add">
                <input
                  className="company-vocab-input"
                  value={newTag}
                  maxLength={40}
                  placeholder="New category"
                  aria-label="New contact category"
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const name = newTag.trim()
                    if (!name) return
                    setStatus('Saving…')
                    void createTag.mutateAsync({ name }).then(
                      () => {
                        setNewTag('')
                        setStatus('Saved.')
                      },
                      (err: unknown) => note('Saved.', err),
                    )
                  }}
                />
                <button
                  type="button"
                  className="section-add-btn"
                  disabled={!newTag.trim() || createTag.isPending}
                  onClick={() => {
                    const name = newTag.trim()
                    if (!name) return
                    setStatus('Saving…')
                    void createTag.mutateAsync({ name }).then(
                      () => {
                        setNewTag('')
                        setStatus('Saved.')
                      },
                      (err: unknown) => note('Saved.', err),
                    )
                  }}
                >
                  + Add
                </button>
              </div>
            )}
          </div>
        </div>
      )

  if (inSlideout) {
    return (
      <div className="company-vocab-slideout-shell" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {status && <span className="company-status" role="status" style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>{status}</span>}
        {content}
      </div>
    )
  }

  return (
    <section className="company-group" aria-labelledby="company-vocab-title">
      <SectionHeader title="Vocabulary" titleId="company-vocab-title">
        {status && <span className="company-status" role="status">{status}</span>}
      </SectionHeader>
      {content}
    </section>
  )
}
