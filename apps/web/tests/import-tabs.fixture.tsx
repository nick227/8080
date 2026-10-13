import { createRoot } from 'react-dom/client'
import { BrowserRouter, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { RecordImportFlow } from '../src/features/records/RecordImportFlow'
import { ImportModal } from '../src/features/calendar/ImportModal'
import { ImportDocumentsSlideout } from '../src/features/documents/DocumentsList'
import { ImportTeamSlideout } from '../src/features/team/TeamTableView'
import { ImportBudgetSlideout } from '../src/features/budget/BudgetTable'
import { AgentImportSlideout } from '../src/features/agents/AgentImportSlideout'
import '../src/features/work/FormSlideout.css'
import '../src/features/prefab/api-connections.css'
import '../src/features/records/records.css'

createApiClient({ baseUrl: 'http://imports.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function TestApp() {
  const [params] = useSearchParams()
  const modal = params.get('modal') || 'contacts'

  return (
    <div style={{ padding: 10 }}>
      {modal === 'contacts' && (
        <RecordImportFlow
          kind="contacts"
          workspaceId="ws-test-123"
          onClose={() => {}}
        />
      )}

      {modal === 'inventory' && (
        <RecordImportFlow
          kind="inventory"
          workspaceId="ws-test-123"
          onClose={() => {}}
        />
      )}

      {modal === 'tasks' && (
        <ImportModal
          workspaceId="ws-test-123"
          day="2026-10-15"
          onClose={() => {}}
          onImport={() => 1}
        />
      )}

      {modal === 'documents' && (
        <ImportDocumentsSlideout
          workspaceId="ws-test-123"
          owner="Test Owner"
          onClose={() => {}}
          onImportDocs={() => {}}
        />
      )}

      {modal === 'team' && (
        <ImportTeamSlideout
          workspaceId="ws-test-123"
          onClose={() => {}}
          onImportRoles={() => {}}
        />
      )}

      {modal === 'budget' && (
        <ImportBudgetSlideout
          workspaceId="ws-test-123"
          onClose={() => {}}
          onImported={() => {}}
        />
      )}

      {modal === 'agents' && (
        <AgentImportSlideout
          workspaceId="ws-test-123"
          onClose={() => {}}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={client}>
      <TestApp />
    </QueryClientProvider>
  </BrowserRouter>
)
