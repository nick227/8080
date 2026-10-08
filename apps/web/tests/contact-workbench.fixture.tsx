import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { RecordsExperience } from '../src/features/records/RecordsExperience'
import { WorkNav } from '../src/features/work/WorkNav'
createApiClient({ baseUrl: 'https://contacts.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter>
  <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <WorkNav desk="contacts" teamActive={false} onSelect={() => {}} />
    <main style={{ display: 'flex', flex: 1, minHeight: 0 }}><RecordsExperience kind="contacts" /></main>
  </div>
</BrowserRouter></QueryClientProvider>)
