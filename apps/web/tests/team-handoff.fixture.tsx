import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom'
import { createApiClient, useRoom, useRoomCompany, useRoomParticipants } from '@project/sdk'
import { OpenCompanyChannel } from '../src/features/company/OpenCompanyChannel'
import { useRoomRef } from '../src/app/useRoomRef'
createApiClient({ baseUrl: 'https://team.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Room() {
  const { id } = useParams()
  const room = useRoomRef(id!)
  const detail = useRoom(room.data)
  const company = useRoomCompany(id)
  const people = useRoomParticipants(room.data)
  const ready = !!room.data && !!detail.data && !!company.data && !!people.data
  if (!ready) document.documentElement.dataset.coldRoom = 'true'
  return <h1>{ready ? 'Team ready' : 'Cold room'}</h1>
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><Link to="/board">Board</Link><Routes><Route path="/" element={<OpenCompanyChannel workspaceId="workspace" />} /><Route path="/board" element={<h1>Board</h1>} /><Route path="/room/:id" element={<Room />} /></Routes></BrowserRouter></QueryClientProvider></StrictMode>)
