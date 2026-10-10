import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../state/ui'
import { useShell } from '../../state/shell'
import { createProjectOnly, THUMB_ACCEPT, thumbFileProblem, type ThumbChoice } from './newConversation'
import './newProject.css'

export type ProjectIdentityData = {
  title: string
  description: string
  thumb: ThumbChoice | null
}

export function NewProjectSurface({
  onClose,
  onProceedToRecord,
}: {
  onClose: () => void
  onProceedToRecord?: (data: ProjectIdentityData) => void
}) {
  const navigate = useNavigate()
  const ui = useUI()
  const fileRef = useRef<HTMLInputElement>(null)
  
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<ThumbChoice | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [createPost, setCreatePost] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleFileChange = (file: File) => {
    const problem = thumbFileProblem(file)
    if (problem) {
      ui.setError(problem)
      return
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setPicked({ kind: 'file', file, preview: url })
  }

  const handleCreate = async () => {
    if (creating) return
    if (createPost && onProceedToRecord) {
      onProceedToRecord({
        title,
        description,
        thumb: picked,
      })
      return
    }

    setCreating(true)
    try {
      const room = await createProjectOnly({
        title,
        description,
        thumb: picked,
      })
      onClose()
      useShell.getState().minimizeRecord()
      ui.setIdle()
      navigate(`/room/${room.id}`) // a new conversation opens on itself (its company page is one click away)
    } catch (e) {
      ui.setError(`Could not create project: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="new-project-overlay" role="dialog" aria-label="New Project">
      <div className="new-project-card">
        <header className="new-project-header">
          <h2>New Project</h2>
          <p className="new-project-kicker">Identity</p>
        </header>

        <div className="new-project-body">
          <div className="new-project-thumb-row">
            <button
              type="button"
              className="new-project-thumb-btn"
              aria-label="Project image"
              onClick={() => fileRef.current?.click()}
            >
              {previewUrl ? <img src={previewUrl} alt="" /> : <span>+</span>}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={THUMB_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleFileChange(file)
              }}
            />
            <div className="new-project-thumb-info">
              <label>Project image</label>
              <span className="new-project-hint">Choose an image for your project</span>
            </div>
          </div>

          <label className="new-project-field">
            <span>Project name</span>
            <input
              type="text"
              placeholder="e.g. Q4 Growth Campaign"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
            />
          </label>

          <label className="new-project-field">
            <span>What is this project about? (optional)</span>
            <textarea
              rows={3}
              placeholder="Describe goals, scope, or key details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="new-project-checkbox-label">
            <input
              type="checkbox"
              checked={createPost}
              onChange={(e) => setCreatePost(e.target.checked)}
            />
            <span>Create first post</span>
          </label>
        </div>

        <footer className="new-project-actions">
          <button type="button" className="new-project-btn-cancel" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="button" className="new-project-btn-submit" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? 'Creating…' : createPost ? 'Next: First Post' : 'Create Project'}
          </button>
        </footer>
      </div>
    </div>
  )
}
