export type ImportTabItem = {
  id: string
  label: string
  badge?: string
  ariaLabel?: string
}

export function BlueprintModalSubtitle(_props?: { slug?: string; name?: string }) {
  return null
}

export function ImportModalTabs({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: ImportTabItem[]
  activeTab: string
  onSelectTab: (id: string) => void
}) {
  return (
    <div className="import-modal-tabs" aria-label="Import tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-label={tab.ariaLabel || tab.label}
          aria-pressed={activeTab === tab.id}
          className={`import-modal-tab${activeTab === tab.id ? ' active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
          {tab.badge && <span className="import-modal-tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export { ApiConnectionsPanel, type ApiDomain } from './ApiConnectionsPanel'

