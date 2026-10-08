import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import type { RecipientConfig } from '@project/shared'
import { AudienceEditor } from '../src/features/agents/AudienceEditor'
import '../src/features/agents/agents.css'
createApiClient({ baseUrl: 'https://audience.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
function Fixture() {
  const [config, setConfig] = useState<RecipientConfig | null>(null)
  return <main><AudienceEditor workspaceId="w1" config={config} count={2} editable save={async c => { setConfig(c) }} /></main>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><Fixture /></BrowserRouter></QueryClientProvider>)
