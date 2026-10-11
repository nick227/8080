import { useEffect, useRef, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { businessCategories, businessExamples, type ExampleBusiness } from './businessExamples'
import { WorkspaceList } from './WorkspaceList'
import { WorkspaceExample } from './WorkspaceExample'
import './community.css'

export function DirectoryIcon({ kind }: { kind: 'browse' | 'workspace' | 'conversation' | 'plus' | 'search' }) {
  const paths = {
    browse: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    workspace: <><path d="M3 8h18v12H3zM8 8V4h8v4M3 13h18M10 13v3h4v-3" /></>,
    conversation: <path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[kind]}</svg>
}

export function DirectorySearch() {
  const [params, setParams] = useSearchParams()
  const value = params.get('q') ?? ''
  return <form className="community-search" role="search" onSubmit={(event) => event.preventDefault()}>
    <DirectoryIcon kind="search" />
    <input aria-label="Search example workspaces" placeholder="Search example workspaces" type="search" value={value} onChange={(event) => {
      const next = new URLSearchParams(params)
      next.delete('example')
      if (event.target.value) next.set('q', event.target.value); else next.delete('q')
      setParams(next, { replace: true })
    }} />
  </form>
}

export function DirectoryRail() {
  return <aside className="community-rail" aria-label="Workspace navigation">
    <nav aria-label="Browse navigation">
      <Link to="/" aria-current="page"><DirectoryIcon kind="browse" />Browse workspaces</Link>
      <Link to="/workspaces"><DirectoryIcon kind="workspace" />Your workspaces</Link>
      <Link to="/conversations"><DirectoryIcon kind="conversation" />Conversations</Link>
    </nav>
    <div className="community-rail-memberships"><WorkspaceList compact /></div>
    <Link className="community-create" to="/workspaces/new"><DirectoryIcon kind="plus" />Create a workspace</Link>
    <div className="community-rail-about"><strong>What is 8080?</strong><p>Workspaces for business contacts, inventory, documents, and conversations.</p><a href="#about-8080" onClick={() => { const details = document.getElementById('about-8080'); if (details instanceof HTMLDetailsElement) details.open = true }}>About workspaces</a></div>
  </aside>
}

function BusinessMark({ business }: { business: ExampleBusiness }) {
  return <span className="business-mark" style={{ '--business-color': business.color } as CSSProperties} aria-hidden>{business.initials}</span>
}

function BusinessCard({ business, search }: { business: ExampleBusiness; search: string }) {
  const params = new URLSearchParams(search)
  params.set('example', business.id)
  return <article className="business-card">
    <Link to={`/?${params}`} aria-label={`View ${business.name} example workspace`}>
      <div className="business-cover"><img src={`/workspace-examples/${business.image}.jpg`} alt="" loading="lazy" /><span className="business-cover-label">{business.coverLabel}</span><span className="business-example-badge">Example</span></div>
      <div className="business-card-info"><BusinessMark business={business} /><div><h2>{business.name}</h2><p>{business.description}</p><span className="business-meta">{business.category}<span aria-hidden> · </span>{business.location}</span></div></div>
    </Link>
  </article>
}

export function BusinessDirectory() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'All'
  const query = (params.get('q') ?? '').trim().toLocaleLowerCase()
  const selected = businessExamples.find((business) => business.id === params.get('example'))
  const profileHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (selected) { profileHeading.current?.focus(); window.scrollTo(0, 0) } }, [selected])
  const filtered = businessExamples.filter((business) => (category === 'All' || business.category === category) && `${business.name} ${business.description} ${business.category} ${business.location}`.toLocaleLowerCase().includes(query))
  const backParams = new URLSearchParams(params); backParams.delete('example')
  return <div className="community-frame"><DirectoryRail /><div className="community-content">
    {selected ? <>
      <Link className="community-back" to={backParams.size ? `/?${backParams}` : '/'}>← Browse workspaces</Link>
      <div className="business-profile-cover"><img src={`/workspace-examples/${selected.image}.jpg`} alt="" /><span>Example workspace · Fictional business</span></div>
      <div className="business-profile-heading"><BusinessMark business={selected} /><div><h1 tabIndex={-1} ref={profileHeading}>{selected.name}</h1><p>{selected.category} · {selected.location}</p></div><Link className="product-button product-button-secondary" to="/workspaces/new">Create your own workspace</Link></div>
      <div className="business-profile-content"><section><h2>About this example</h2><p>{selected.description}</p><p>{selected.detail}</p><h2>In this workspace</h2><ul>{selected.items.map(item => <li key={item}>{item}</li>)}</ul><p className="community-muted">This is a fictional business profile. It is not a business account or a workspace you can join.</p></section>{selected.id === 'fieldwork' ? <WorkspaceExample /> : <section className="business-profile-guide"><h2>How workspaces work</h2><p>A workspace contains a company's contacts, inventory, documents, team members, and linked conversations.</p><p>You can create a workspace or join one by invitation. Each workspace has its own members and records.</p><Link to="/?example=fieldwork">View the contact, document, and conversation example →</Link></section>}</div>
    </> : <>
      <div className="community-categories" role="group" aria-label="Business categories">{businessCategories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => {
        const next = new URLSearchParams(params)
        if (item === 'All') next.delete('category'); else next.set('category', item)
        setParams(next)
      }}>{item}</button>)}</div>
      <header className="community-title"><div><h1>Workspaces</h1><p>Browse business profiles and see what goes into a workspace.</p></div><span className="community-count">{filtered.length} {filtered.length === 1 ? 'workspace' : 'workspaces'}</span></header>
      <div className="community-example-notice"><span>Example directory</span><p>These businesses are fictional. Your workspaces are listed separately.</p></div>
      {filtered.length ? <div className="business-grid">{filtered.map(business => <BusinessCard key={business.id} business={business} search={params.toString()} />)}</div> : <div className="community-no-results"><h2>No matching workspaces</h2><p>Try a different business name, location, or category.</p><button className="product-button product-button-secondary" onClick={() => setParams({})}>Clear search and filters</button></div>}
    </>}
    <AboutWorkspaces />
  </div></div>
}

function AboutWorkspaces() {
  return <details id="about-8080" className="community-about"><summary>About 8080 and workspaces</summary><div><h2>What is a workspace?</h2><p>A workspace contains a company's contacts, inventory, documents, team members, and linked conversations. You sign in with one account and can belong to more than one workspace.</p><p>You can create a workspace or join one by invitation. Each workspace has its own members and records.</p><Link to="/workspaces/new">Create a workspace →</Link></div></details>
}
