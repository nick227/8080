import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { createApiClient } from '@project/sdk'
import { AdminUsers } from '../src/features/admin/AdminUsers'
import { AdminBilling } from '../src/features/admin/AdminBilling'
import { AdminBlueprints } from '../src/features/admin/AdminBlueprints'
import '../src/styles/tokens.css'
createApiClient({ baseUrl: 'https://admin.test/api' })
const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(<React.StrictMode><HelmetProvider><QueryClientProvider client={query}><BrowserRouter><Routes><Route path="/admin" element={<AdminUsers />} /><Route path="/admin/billing" element={<AdminBilling />} /><Route path="/admin/blueprints" element={<AdminBlueprints />} /></Routes></BrowserRouter></QueryClientProvider></HelmetProvider></React.StrictMode>)
