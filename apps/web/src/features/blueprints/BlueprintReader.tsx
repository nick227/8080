import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SEO } from '../../components/SEO'
import { blueprints, money, scenarioData, type Blueprint, type Scenario } from './data'
import './reader.css'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// One page: what the business is, how it runs, who does what, the 90-day plan and the money.
export function BlueprintReader() {
  const { slug } = useParams()
  const bp = blueprints.find(b => b.slug === slug)
  if (!bp) return <div className="bp-empty"><h1>Blueprint not found</h1><p>This Blueprint is not in the collection.</p><Link to="/blueprints">Browse Blueprints</Link></div>
  const data = scenarioData(bp, '90')
  const firstName = (id: string) => data.people.find(p => p.id === id)?.name.split(' ')[0] ?? ''
  const routine = data.tasks.filter(t => t.repeat !== undefined).sort((a, b) => a.repeat! - b.repeat!)
  const income = data.budget.filter(b => b.direction === 'income')
  const expenses = data.budget.filter(b => b.direction === 'expense')

  return <div className="bpr" style={{ '--bp-accent': bp.accent } as CSSProperties}>
    <SEO title={`${bp.type} Blueprint — 8080`} description={bp.brief.summary} />
    <nav className="bpr-top">
      <Link to="/blueprints">← Blueprints</Link>
      <span>
        <button type="button" onClick={() => download(bp, data)}>Download .json</button>
        <Link to="/workspaces/new" className="bpr-primary">Apply to a workspace →</Link>
      </span>
    </nav>

    <header className="bpr-head">
      <img src={`/workspace-examples/${bp.image}.jpg`} alt="" />
      <div>
        <h1>{bp.title}</h1>
        <p>{bp.brief.summary}</p>
      </div>
    </header>

    <dl className="bpr-stats">
      <div><dt>People</dt><dd>{data.people.length}</dd></div>
      <div><dt>Projects</dt><dd>{data.projects.length}</dd></div>
      <div><dt>90-day income</dt><dd>{money(data.totalIncome)}</dd></div>
      <div><dt>Costs</dt><dd>{money(data.totalExpenses)}</dd></div>
      <div><dt>Margin</dt><dd>{money(data.netMargin)}</dd></div>
    </dl>

    <section>
      <h2>How it works</h2>
      <ul className="bpr-how">{bp.brief.how.map(line => <li key={line}>{line}</li>)}</ul>
    </section>

    <div className="bpr-split">
      <section>
        <h2>Team</h2>
        <ul className="bpr-rows">{data.people.map(p => <li key={p.id}><span><strong>{p.name}</strong><small>{p.role}</small></span><span>{p.hours} h/wk</span></li>)}</ul>
      </section>
      <section>
        <h2>Every week</h2>
        <ul className="bpr-rows">{routine.map(t => <li key={t.id}><span><strong>{t.title}</strong><small>{DAYS[t.repeat!]} · {firstName(t.person)}</small></span><span>{t.minutes} min</span></li>)}</ul>
      </section>
    </div>

    <section>
      <h2>90-day plan</h2>
      <ol className="bpr-plan">{data.projects.map(p => {
        const tasks = data.tasks.filter(t => t.project === p.id)
        const milestone = data.milestones.find(m => m.project === p.id)!
        return <li key={p.id}>
          <details>
            <summary>
              <span className="bpr-days">Day {Math.min(...tasks.map(t => t.day)) + 1}–{milestone.day + 1}</span>
              <span><strong>{p.title}</strong><small>Done when: {p.outcome}</small></span>
              <span className="bpr-count">{tasks.length} tasks</span>
            </summary>
            <ul>{tasks.map(t => <li key={t.id}>{t.title} <small>{firstName(t.person)} · {t.minutes} min</small></li>)}</ul>
          </details>
        </li>
      })}</ol>
    </section>

    <section>
      <h2>Budget, first 90 days</h2>
      <table className="bpr-budget">
        <tbody>
          {income.map(b => <tr key={b.label}><th scope="row">{b.label}</th><td>+{money(b.amount)}</td></tr>)}
          {expenses.map(b => <tr key={b.label} className="bpr-cost"><th scope="row">{b.label}</th><td>−{money(b.amount)}</td></tr>)}
        </tbody>
        <tfoot><tr><th scope="row">Margin</th><td>{money(data.netMargin)}</td></tr></tfoot>
      </table>
    </section>

    <footer className="bpr-foot">
      <p>Example people and numbers. Owner pay, rent and taxes are not included.</p>
      <Link to="/workspaces/new">Apply to a workspace →</Link>
    </footer>
  </div>
}

function download(bp: Blueprint, data: Scenario) {
  const bundle = {
    $schema: 'https://8080.app/schemas/blueprint-v1.json',
    manifest: { id: `blueprint.${bp.slug}`, slug: bp.slug, version: '1.0.0', exportedAt: new Date().toISOString() },
    metadata: { title: bp.title, subtitle: bp.subtitle, description: bp.description, specialization: bp.specialization },
    scenarios: { '90': { netMargin: data.netMargin, totalIncome: data.totalIncome, totalExpenses: data.totalExpenses, capacity: data.capacity, budget: data.budget } },
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${bp.slug}-blueprint.json`
  a.click()
  URL.revokeObjectURL(url)
}
