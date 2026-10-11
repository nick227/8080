import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { BookIcon, ChartMetricsIcon, PlugIcon, UserCardIcon } from '../../components/icons'
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

export type CompanySubTab = 'dashboard' | 'profile' | 'integrations' | 'vocabulary'

export function CompanyDesk({ onPlace }: { roomId?: string; onPlace?: (desk: Desk) => void; onOpenComposer?: () => void }) {
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin'
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  
  const currentTab = (searchParams.get('tab') as CompanySubTab) || 'dashboard'
  const [vocabOpen, setVocabOpen] = useState(false)

  const setTab = (tab: CompanySubTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }

  const go = (link: DeskLink) => {
    if (onCompanyPath(location.pathname)) {
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
    <div className="company">

      {/* Sub-Tab Navigation Bar */}
      <nav className="company-subtabs" aria-label="Company section tabs">
        <button
          type="button"
          className="company-subtab-btn"
          aria-current={currentTab === 'dashboard' ? 'page' : undefined}
          onClick={() => setTab('dashboard')}
        >
          <ChartMetricsIcon />
          <span>Dashboard</span>
        </button>
        <button
          type="button"
          className="company-subtab-btn"
          aria-current={currentTab === 'profile' ? 'page' : undefined}
          onClick={() => setTab('profile')}
        >
          <UserCardIcon />
          <span>Profile</span>
        </button>
        <button
          type="button"
          className="company-subtab-btn"
          aria-current={currentTab === 'integrations' ? 'page' : undefined}
          onClick={() => setTab('integrations')}
        >
          <PlugIcon />
          <span>Integrations</span>
        </button>
        <button
          type="button"
          className="company-subtab-btn"
          aria-current={currentTab === 'vocabulary' ? 'page' : undefined}
          onClick={() => setTab('vocabulary')}
        >
          <BookIcon />
          <span>Vocabulary</span>
        </button>
      </nav>

      {/* Tab Content Views */}
      <div className="company-tab-content">
        {currentTab === 'dashboard' && (
          <OverviewSection workspaceId={workspaceId} />
        )}

        {currentTab === 'profile' && (
          <div className="company-split">
            <div className="company-col company-col-profile">
              <CompanyProfileSection workspaceId={workspaceId} canEdit={!!canEdit} />
            </div>
            <div className="company-col company-col-side">
              <div className="company-gallery" style={{ padding: 0 }}>
                <RecordGallery workspaceId={workspaceId} kind="company" recordId={workspaceId} name={workspace?.name ?? 'Company'} />
              </div>
            </div>
          </div>
        )}

        {currentTab === 'integrations' && (
          <IntegrationsSection workspaceId={workspaceId} canEdit={!!canEdit} />
        )}

        {currentTab === 'vocabulary' && (
          <VocabularySection workspaceId={workspaceId} canEdit={!!canEdit} />
        )}
      </div>

      {vocabOpen && (
        <FormSlideout title="Workspace Vocabulary" onClose={() => setVocabOpen(false)}>
          <VocabularySection workspaceId={workspaceId} canEdit={!!canEdit} inSlideout />
        </FormSlideout>
      )}
    </div>
  )
}

