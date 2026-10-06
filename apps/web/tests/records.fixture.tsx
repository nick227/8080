import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { RecordsExperience } from '../src/features/records/RecordsExperience'
import { useWorkPlace } from '../src/features/records/navigation'
import '../src/features/work/work.css'

createApiClient({ baseUrl: 'http://records.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
function Fixture() {
  const [place, select] = useWorkPlace()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <nav aria-label="Workspace" style={{ display: 'flex', gap: 24, padding: 16 }}>
        <button onClick={() => select('contacts')}>Contacts</button>
        <button onClick={() => select('inventory')}>Inventory</button>
      </nav>
      <main style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {place === 'contacts' || place === 'inventory' ? (
          <RecordsExperience key={place} kind={place} />
        ) : (
          <p>Team</p>
        )}
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <Fixture />
    </BrowserRouter>
  </QueryClientProvider>,
)
