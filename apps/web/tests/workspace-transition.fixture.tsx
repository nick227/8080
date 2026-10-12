import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceLoading, WorkspaceTransition } from '../src/features/work/WorkspaceTransition'
function Fixture() {
  const [view, setView] = useState('Lists')
  const [loading, setLoading] = useState(false)
  return <><nav>{['Lists', 'Board', 'Calendar', 'Team'].map(v => <button key={v} onClick={() => setView(v)}>{v}</button>)}<button onClick={() => setLoading(v => !v)}>Toggle loading</button></nav><WorkspaceTransition view={view}>{loading ? <WorkspaceLoading /> : <div className="workspace-content"><h1>{view}</h1><input aria-label="Draft" /></div>}</WorkspaceTransition></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
