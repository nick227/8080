import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '@project/sdk'
import { Workspaces } from './Workspaces'

export function Home() {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const params = new URLSearchParams(location.search)
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [location.hash])
  useEffect(() => {
    // Google returns to the frontend root. Resume only this fixed creation route.
    try {
      if (session.data?.data.isGuest === false && sessionStorage.getItem('8080.create-workspace') === '1') {
        sessionStorage.removeItem('8080.create-workspace')
        navigate('/workspaces/new', { replace: true })
      }
    } catch { /* The homepage still works if browser storage is unavailable. */ }
  }, [session.data, navigate])
  if (params.get('record') === '1') return <Navigate to={`/conversations${location.search}`} replace />
  return <>
    {params.get('authError') && <p role="alert">Sign-in failed. Please try signing in again.</p>}
    <Workspaces />
  </>
}
