import { Link } from 'react-router-dom'
import { SEO } from '../../components/SEO'
import { blueprints, scenarioData, money } from './data'

export function BlueprintCatalog() {
  return <div className="app-page bp-catalog">
    <SEO title="Blueprint Catalog — 8080" description="Explore detailed operating plans for solo businesses, small teams, and project studios. 8080 is a CRM and work management platform." />
    <div className="product-page-heading"><h1>Blueprints</h1></div>
    <div className="bp-catalog-grid">{blueprints.map((bp,i) => {
      const scenario = scenarioData(bp,'90')
      return <article className="bp-catalog-card" key={bp.slug}>
        <Link to={`/blueprints/${bp.slug}`} aria-label={`Read ${bp.type}`}>
          <div className="bp-card-photo"><img src={`/workspace-examples/${bp.image}.jpg`} alt="" loading={i === 0 ? 'eager' : 'lazy'} /></div>
          <div className="bp-card-copy">
            <h2>{bp.title}</h2><p>{bp.description}</p>
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
    })}</div>
    <p className="bp-catalog-note">Fictional operational examples. All models are calibrated as 90-day starter plans demonstrating realistic staffing, structured task workflows, and dual-sided cashflow economics; salaries, premises rent, and taxes are excluded.</p>

    <section className="bp-platform-note"><div><strong>8080 is a work management platform</strong></div><Link to="/workspaces/new">Create a workspace <span aria-hidden>→</span></Link></section>
  </div>
}
