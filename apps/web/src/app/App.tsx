import { useSession } from '@project/sdk'
import { Routes } from './routes'

// Guest-first: every view assumes a session, so establish it before rendering.
export function App() {
  const session = useSession()
  if (session.isError) return <p role="alert">Unable to start a session. Is the API running?</p>
  if (!session.data) return null
  return <Routes />
}
