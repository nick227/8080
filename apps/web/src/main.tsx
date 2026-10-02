import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { createApiClient } from '@project/sdk'
import { App } from './app/App'
import './styles/tokens.css'
import './styles/globals.css'

// Once, before anything renders. Web auth rides the httpOnly session cookie.
createApiClient({ baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001' })

const client = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </HelmetProvider>
  </React.StrictMode>
)
