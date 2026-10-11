import { Routes } from './routes'

// Public product pages render while the session loads. App routes gate themselves.
export function App() {
  return <Routes />
}
