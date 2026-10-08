import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { CalendarExperience } from '../src/features/calendar/CalendarExperience'
import { DocumentsList } from '../src/features/documents/DocumentsList'
import { useDocuments } from '../src/features/documents/store'
import '../src/features/work/work.css'

createApiClient({ baseUrl: 'https://creation.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Fixture() {
  const [page, setPage] = useState('calendar')
  const docs = useDocuments((state) => state.docs)
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <nav><button onClick={() => setPage('calendar')}>Calendar page</button><button onClick={() => setPage('documents')}>Documents page</button></nav>
    {page === 'calendar' ? <CalendarExperience /> : <DocumentsList owner="Test owner" />}
    <output aria-label="Created surfaces">{docs.map((doc) => doc.surface).join(',')}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>)
