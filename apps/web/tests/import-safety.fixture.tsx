import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { RecordImportFlow } from '../src/features/records/RecordImportFlow'
createApiClient({ baseUrl: 'http://imports.test/api' })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RecordImportFlow
      kind="contacts"
      workspaceId="workspace"
      onClose={() => {
        document.body.dataset.closed = 'true'
      }}
    />
  </QueryClientProvider>,
)
