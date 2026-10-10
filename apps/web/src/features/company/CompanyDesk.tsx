import { CalendarExperience } from '../calendar/CalendarExperience'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMyWorkspaces, useRoom, useUpdateRoom } from '@project/sdk'
import { BookIcon } from '../../components/icons'
import { useUI } from '../../state/ui'
import { RecordGallery } from '../records/RecordGallery'
import { FormSlideout } from '../work/FormSlideout'
import { SectionHeader } from '../work/SectionHeader'
import type { Desk } from '../work/sections'
import { CompanyProfileSection } from './CompanyProfileSection'
import { IntegrationsSection } from './IntegrationsSection'
import { OverviewSection } from './OverviewSection'
import { VocabularySection } from './VocabularySection'
import { applyDeskLink, type DeskLink } from './links'
import '../records/records.css'
import './company.css'

export function CompanyDesk({ roomId, onPlace }: { roomId?: string; onPlace?: (desk: Desk) => void; onOpenComposer?: () => void }) {
  const ui = useUI()
  const workspace = useMyWorkspaces().data?.[0] ?? null
  const workspaceId = workspace?.id
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin'
  const navigate = useNavigate()
  const location = useLocation()
  const [vocabOpen, setVocabOpen] = useState(false)

  const roomQuery = useRoom(roomId ?? '')
  const updateRoom = useUpdateRoom(roomId ?? '')
  const room = roomId ? roomQuery.data : null
  const visibility = room?.visibility ?? 'public'

  const go = (link: DeskLink) => {
    applyDeskLink(link, (desk) => onPlace?.(desk), (params) => {
      navigate({ pathname: location.pathname, search: params.toString() })
    })
  }

  const handleVisibilityChange = (next: 'public' | 'private') => {
    if (!roomId) return
    void updateRoom.mutateAsync({ visibility: next }).catch((err: unknown) => {
      ui.setError(err instanceof Error ? err.message : 'Could not change project visibility')
    })
  }

  if (!workspaceId) {
    return <p className="work-empty">Join or create a workspace to see project details.</p>
  }

  return (
    <div className="company company-with-table">
      <SectionHeader title="Project Overview" titleId="company-title" level={1}>
        <button
          type="button"
          className="vocab-icon-btn"
          onClick={() => setVocabOpen(true)}
          title="Open Workspace Vocabulary"
          aria-label="Vocabulary"
        >
          <BookIcon />
          <span>Vocabulary</span>
        </button>
      </SectionHeader>

      <div className="company-split">
        <div className="company-col company-col-profile">
          <CompanyProfileSection
            workspaceId={workspaceId}
            canEdit={!!canEdit}
            visibility={visibility}
            onVisibilityChange={handleVisibilityChange}
            updatingVisibility={updateRoom.isPending}
            showVisibility={!!roomId}
          />
          <div className="company-gallery">
            <RecordGallery workspaceId={workspaceId} kind="company" recordId={workspaceId} name={workspace?.name ?? 'Project'} />
          </div>
        </div>
        <div className="company-col company-col-side">
          <OverviewSection workspaceId={workspaceId} onLink={go} />
          <IntegrationsSection workspaceId={workspaceId} canEdit={!!canEdit} />
        </div>
      </div>

      <section className="company-table-section" aria-label="Table">
        <CalendarExperience section="table" />
      </section>

      {vocabOpen && (
        <FormSlideout title="Workspace Vocabulary" onClose={() => setVocabOpen(false)}>
          <VocabularySection workspaceId={workspaceId} canEdit={!!canEdit} inSlideout />
        </FormSlideout>
      )}
    </div>
  )
}
