import { useEffect, useLayoutEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '@project/sdk'
import { WorkspaceList } from '../features/home/WorkspaceList'
import { Lobby } from '../features/Lobby'
import { blueprints, scenarioData, money } from '../features/blueprints/data'
import { RecordModalSurface } from '../features/conversation/RecordModalSurface'
import { useShell } from '../state/shell'
import { SEO } from '../components/SEO'

export function Home() {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const params = new URLSearchParams(location.search)

  useLayoutEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const record = searchParams.get('record') === '1'
    if (record) {
      useShell.getState().openRecord()
      searchParams.delete('record')
      const next = searchParams.toString()
      window.history.replaceState(null, '', next ? `/?${next}` : '/')
    }
  }, [])

  useEffect(() => {
    const target = location.hash ? location.hash.slice(1) : (
      location.pathname === '/workspaces' ? 'workspaces' :
      location.pathname === '/conversations' ? 'community' :
      location.pathname === '/blueprints' ? 'blueprints' : null
    )
    if (target) {
      const el = document.getElementById(target)
      el?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [location.hash, location.pathname])

  useEffect(() => {
    // Google returns to the frontend root. Resume only this fixed creation route.
    try {
      if (session.data?.data.isGuest === false && sessionStorage.getItem('8080.create-workspace') === '1') {
        sessionStorage.removeItem('8080.create-workspace')
        navigate('/workspaces/new', { replace: true })
      }
    } catch { /* The homepage still works if browser storage is unavailable. */ }
  }, [session.data, navigate])

  return (
    <div className="app-page home-page">
      <SEO
        title="8080 — Workspaces, Community & Blueprints"
        description="8080 work management platform: workspaces, community conversations, and operating blueprints."
      />
      {params.get('authError') && <p role="alert">Sign-in failed. Please try signing in again.</p>}

      {/* Section 1: Your Workspaces */}
      <section id="workspaces" className="home-section" aria-labelledby="heading-workspaces">
        <div className="product-page-heading">
          <h1 id="heading-workspaces">Your workspaces</h1>
          <p>Manage your company records, inventory, documents, and connected workspaces.</p>
        </div>
        <WorkspaceList />
      </section>

      {/* Section 2: Community */}
      <section id="community" className="home-section" aria-labelledby="heading-community">
        <div className="product-page-heading">
          <h2 id="heading-community">Community</h2>
          <p>Explore public workspaces and open conversations across the network.</p>
        </div>
        <Lobby />
      </section>

      {/* Section 3: Blueprints */}
      <section id="blueprints" className="home-section bp-catalog" aria-labelledby="heading-blueprints">
        <div className="product-page-heading">
          <h2 id="heading-blueprints">Blueprints</h2>
          <p>Explore detailed operating plans for solo businesses, small teams, and project studios.</p>
        </div>
        <div className="bp-catalog-grid">
          {blueprints.map((bp, i) => {
            const scenario = scenarioData(bp, '90')
            return (
              <article className="bp-catalog-card" key={bp.slug}>
                <Link to={`/blueprints/${bp.slug}`} aria-label={`Read ${bp.type}`}>
                  <div className="bp-card-photo">
                    <img src={`/workspace-examples/${bp.image}.jpg`} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
                  </div>
                  <div className="bp-card-copy">
                    <h2>{bp.title}</h2>
                    <p>{bp.description}</p>
                    <p className="bp-card-specialization">{bp.specialization}</p>
                    <dl className="bp-card-numbers">
                      <div><dt>People</dt><dd>{scenario.people.length}</dd></div>
                      <div><dt>Projects</dt><dd>{scenario.projects.length}</dd></div>
                      <div><dt>Tasks</dt><dd>{scenario.tasks.length}</dd></div>
                      <div><dt>90-day net margin</dt><dd>+{money(scenario.netMargin)} USD</dd></div>
                    </dl>
                    <span className="bp-read">View Blueprint →</span>
                  </div>
                </Link>
              </article>
            )
          })}
        </div>
        <p className="bp-catalog-note">
          Fictional operational examples. All models are calibrated as 90-day starter plans demonstrating realistic staffing, structured task workflows, and dual-sided cashflow economics; salaries, premises rent, and taxes are excluded.
        </p>
        <section className="bp-platform-note">
          <div><strong>8080 is a work management platform</strong></div>
          <Link to="/workspaces/new">Create a workspace <span aria-hidden>→</span></Link>
        </section>
      </section>

      <RecordModalSurface />
    </div>
  )
}
