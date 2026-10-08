import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { CalendarExperience } from '../src/features/calendar/CalendarExperience'
import { useCalendar } from '../src/features/calendar/store'
const client = new QueryClient()
useCalendar.setState({ cursor: '2026-10-08', tasks: [
  { id: 'one', taskKey: 'T-1', title: 'Review customer requests', day: '2026-10-08', time: null, status: 'open', source: null },
  { id: 'two', taskKey: 'T-2', title: 'Prepare weekly update', day: '2026-10-08', time: null, status: 'in_progress', source: null },
  { id: 'other', taskKey: 'T-3', title: 'Next month task', day: '2026-11-08', time: null, status: 'open', source: null },
], accomplishments: [] })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><div style={{ height: '100dvh', display: 'flex', width: '100%' }}><CalendarExperience /></div></BrowserRouter></QueryClientProvider>)
