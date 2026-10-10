import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient } from '@project/sdk'
import { CalendarExperience } from '../src/features/calendar/CalendarExperience'
import { useWorkPlace } from '../src/features/records/navigation'
import '../src/features/work/work.css'
createApiClient({ baseUrl: 'https://tasks.test/api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
function Fixture() {
  const [place, select] = useWorkPlace()
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="Workspace"><button onClick={() => select('tasks')}>Tasks</button><button onClick={() => select('contacts')}>Contacts</button><button onClick={() => select('calendar')}>Calendar</button></nav>
    <main style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      {place === 'tasks' ? <CalendarExperience section="tasks" /> : place === 'calendar' ? <CalendarExperience /> : <p>Contacts surface</p>}
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><BrowserRouter><Routes>
  {['/room/:roomId', '/room/:roomId/tasks', '/room/:roomId/tasks/:taskKey'].map(path => <Route key={path} path={path} element={<Fixture />} />)}
</Routes></BrowserRouter></QueryClientProvider>)
