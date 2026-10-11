import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { createApiClient } from '@project/sdk'
import { App } from '../src/app/App'
import { initializeTheme } from '../src/theme/store'
createApiClient({ baseUrl: 'https://homepage.test/api' })
initializeTheme()
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
createRoot(document.getElementById('root')!).render(<HelmetProvider><QueryClientProvider client={client}><App /></QueryClientProvider></HelmetProvider>)
