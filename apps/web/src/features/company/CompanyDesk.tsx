import { CalendarExperience } from '../calendar/CalendarExperience'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BookIcon } from '../../components/icons'
import { RecordGallery } from '../records/RecordGallery'
import { FormSlideout } from '../work/FormSlideout'
import { SectionHeader } from '../work/SectionHeader'
import type { Desk } from '../work/sections'
import { CompanyProfileSection } from './CompanyProfileSection'
import { IntegrationsSection } from './IntegrationsSection'
import { OverviewSection } from './OverviewSection'
import { VocabularySection } from './VocabularySection'
import { applyDeskLink, type DeskLink } from './links'
import { deskPath } from '../records/navigation'
import { onCompanyPath, projectPath } from '../tasks/links'
import '../records/records.css'
import './company.css'
import { useCurrentWorkspace } from '../../app/workspace'

export function CompanyDesk({ onPlace }: { roomId?: string; onPlace?: (desk: Desk) => void; onOpenComposer?: () => void }) {
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin'
  const navigate = useNavigate()
  const location = useLocation()
  const [vocabOpen, setVocabOpen] = useState(false)

  const go = (link: DeskLink) => {
    if (onCompanyPath(location.pathname)) {
      // One navigation straight to the desk's path, carrying the link's filters.
      const params = new URLSearchParams(Object.entries(link.params ?? {}).filter(([, v]) => v))
      navigate({ pathname: deskPath(projectPath(location.pathname), link.desk as Desk), search: params.toString() })
      return
    }
    applyDeskLink(link, (desk) => onPlace?.(desk), (params) => {
      navigate({ pathname: location.pathname, search: params.toString() })
    })
  }

  if (!workspaceId) {
    return <p className="work-empty">Join or create a company to see its overview.</p>
  }

  return (
    <div className="company company-with-table">
      <SectionHeader title="Company overview" titleId="company-title" level={1}>
        <button
          type="button"
          className="vocab-icon-btn"
          onClick={() => setVocabOpen(true)}
          title="Open company vocabulary"
          aria-label="Vocabulary"
        >
          <BookIcon />
          <span>Vocabulary</span>
        </button>
      </SectionHeader>

      <div className="company-split">
        <div className="company-col company-col-profile">
          <CompanyProfileSection workspaceId={workspaceId} canEdit={!!canEdit} />
          <div className="company-gallery">
            <RecordGallery workspaceId={workspaceId} kind="company" recordId={workspaceId} name={workspace?.name ?? 'Company'} />
          </div>
        </div>
        <div className="company-col company-col-side">
          <OverviewSection workspaceId={workspaceId} />
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
