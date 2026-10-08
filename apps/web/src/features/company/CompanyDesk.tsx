import { useLocation, useNavigate } from 'react-router-dom'
import { useMyWorkspaces, useOpenWorkspaceChannel } from '@project/sdk'
import { RecordGallery } from '../records/RecordGallery'
import { SectionHeader } from '../work/SectionHeader'
import type { Desk } from '../work/sections'
import { CompanyProfileSection } from './CompanyProfileSection'
import { IntegrationsSection } from './IntegrationsSection'
import { OverviewSection } from './OverviewSection'
import { VocabularySection } from './VocabularySection'
import { applyDeskLink, type DeskLink } from './links'
import '../records/records.css'
import './company.css'

export function CompanyDesk({ onPlace }: { onPlace?: (desk: Desk) => void }) {
  const workspace = useMyWorkspaces().data?.[0] ?? null
  const workspaceId = workspace?.id
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin'
  const openChannel = useOpenWorkspaceChannel()
  const navigate = useNavigate()
  const location = useLocation()

  const go = (link: DeskLink) => {
    applyDeskLink(link, (desk) => onPlace?.(desk), (params) => {
      navigate({ pathname: location.pathname, search: params.toString() })
    })
  }

  const openHost = () => {
    if (!workspaceId) return
    void openChannel.mutateAsync(workspaceId).then(({ roomId }) => {
      if (roomId) navigate(`/room/${roomId}`)
    })
  }

  if (!workspaceId) {
    return <p className="work-empty">Join or create a workspace to see company settings.</p>
  }

  return (
    <div className="company">
      <SectionHeader title="Company" titleId="company-title" level={1}>
        <button type="button" className="section-add-btn" disabled={openChannel.isPending} onClick={openHost}>
          Host channel
        </button>
      </SectionHeader>

      <div className="company-split">
        <div className="company-col company-col-profile">
          <CompanyProfileSection workspaceId={workspaceId} canEdit={!!canEdit} onOpenChannel={openHost} />
          <div className="company-gallery">
            <RecordGallery workspaceId={workspaceId} kind="company" recordId={workspaceId} name={workspace?.name ?? 'Company'} />
          </div>
        </div>
        <div className="company-col company-col-side">
          <OverviewSection workspaceId={workspaceId} onLink={go} />
          <VocabularySection workspaceId={workspaceId} canEdit={!!canEdit} />
          <IntegrationsSection workspaceId={workspaceId} canEdit={!!canEdit} />
        </div>
      </div>
    </div>
  )
}
