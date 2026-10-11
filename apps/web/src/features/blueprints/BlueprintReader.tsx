import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { BUDGET_CATEGORIES } from '@project/shared'
import { SEO } from '../../components/SEO'
import { blueprints, horizons, money, scenarioData, type Blueprint, type Horizon, type Scenario } from './data'

const sections = [{id:'overview',label:'Overview'},{id:'people',label:'People'},{id:'roadmap',label:'Roadmap'},{id:'week',label:'A week of work'},{id:'tasks',label:'All tasks'},{id:'documents',label:'Documents'}]
type Open = (kind:string,id:string) => void
export function BlueprintReader() {
  const {slug} = useParams()
  const bp = blueprints.find(b => b.slug === slug)
  const [params,setParams] = useSearchParams()
  const location = useLocation()
  const horizon: Horizon = '90'
  const section = sections.some(s=>s.id===params.get('section')) ? params.get('section')! : 'overview'
  const data = bp ? scenarioData(bp, '90') : null
  function change(key:string,value:string,replace=false) { const next=new URLSearchParams(params); next.set(key,value); if(key==='scenario') { next.delete('inspect'); next.delete('week') }; setParams(next,{replace,state:location.state}) }
  const open: Open = (kind,id) => change('inspect',`${kind}:${id}`)
  const close = () => { const next=new URLSearchParams(params);next.delete('inspect');setParams(next,{replace:true,state:location.state}) }
  useEffect(()=> { document.getElementById('blueprint-main')?.scrollTo(0,0) },[slug,section])
  if(!bp || !data) return <div className="bp-empty"><h1>Blueprint not found</h1><p>This Blueprint is not in the collection.</p><Link to="/blueprints">Browse Blueprints</Link></div>
  return <div className="bp-reader" style={{'--bp-accent':bp.accent} as CSSProperties}>
    <SEO title={`${bp.type} Blueprint — 8080`} description={bp.description} />
    <div className="bp-reader-top"><Link to="/blueprints">← Blueprint catalog</Link></div>
    <div className="bp-reader-heading"><img src={`/workspace-examples/${bp.image}.jpg`} alt="" /><div><h1>{bp.title}</h1><p>{bp.description}</p><p className="bp-reader-specialization">{bp.specialization}</p></div></div>
    <div className="bp-scenario-bar"><div><span>Plan period</span><div className="bp-scenario-controls"><button aria-pressed={true}>90-day starter</button></div></div><p>{data.summary}</p><div className="bp-scenario-stat"><span>{data.people.length} {data.people.length===1?'person':'people'}</span></div></div>
    <nav className="bp-reader-nav" aria-label="Reader sections">{sections.map(s=> { const next=new URLSearchParams(params);next.set('section',s.id);next.delete('inspect');return <Link key={s.id} aria-current={section===s.id?'page':undefined} to={`?${next}`} state={location.state}>{s.label}</Link> })}</nav>
    <div className="bp-reader-body" key={`${bp.slug}:${section}`}>
      {section==='overview' && <Overview bp={bp} data={data} open={open} go={s=>change('section',s)} />}
      {section==='people' && <People bp={bp} data={data} open={open} />}
      {section==='roadmap' && <Roadmap data={data} open={open} />}
      {section==='week' && <Week data={data} open={open} week={Math.min(Math.max(Math.floor(Number(params.get('week')))||1,1),Math.ceil(data.days/7))} onWeek={w=>change('week',String(w))} />}
      {section==='tasks' && <Tasks data={data} open={open} />}
      {section==='documents' && <Documents bp={bp} data={data} open={open} />}
    </div>
    <footer className="bp-reader-footer"><p>Fictional people and operational data. Scenarios are planning examples, not forecasts.</p><Link to="/workspaces/new">Create a blank workspace →</Link></footer>
    {params.get('inspect') && <Inspector bp={bp} data={data} value={params.get('inspect')!} close={close} open={open} />}
  </div>
}
function SectionTitle({title,description}:{title:string;description:string}) { return <div className="bp-section-title"><h2>{title}</h2><p>{description}</p></div> }
function Overview({bp,data,open,go}:{bp:Blueprint;data:Scenario;open:Open;go:(s:string)=>void}) {
 return <>
  <div className="bp-overview-grid"><article className="bp-editorial"><h2>How this business operates</h2><p className="bp-standfirst">{bp.intro}</p><h3>Operating structure & delivery cadence</h3><p>{bp.principle}</p><h3>Service scope & commercial deliverables</h3><p>{bp.offer}</p><h3>Capacity management & constraints</h3><p>{bp.tradeoff}</p><h3>Business development & client acquisition</h3><p>{bp.acquisition}</p></article><aside className="bp-at-a-glance"><h3>90-day starter plan</h3><dl><div><dt>Staffing</dt><dd>{data.capacity}</dd></div><div><dt>Projects</dt><dd>{data.projects.length} planned projects</dd></div><div><dt>Tasks</dt><dd>{data.tasks.length} structured tasks</dd></div><div><dt>Projected income</dt><dd>+{money(data.totalIncome)} USD</dd></div><div><dt>Planned expenses</dt><dd>-{money(data.totalExpenses)} USD</dd></div><div><dt>Operating margin</dt><dd>+{money(data.netMargin)} USD</dd></div></dl><p>Dual-sided 90-day operational model covering projected income streams and operating expenses. Owner salary, premises, and taxes are excluded.</p><button onClick={()=>open('document','budget')}>Read budget plan & assumptions →</button></aside></div>
  <section className="bp-flow-section"><div className="bp-row-heading"><div><h2>Project sequence</h2></div></div><div className="bp-flow" aria-label="First three projects in sequence">{data.projects.slice(0,3).map(project=><button key={project.id} onClick={()=>open('project',project.id)}><strong>{project.title}</strong><small>{project.outcome}</small><span className="bp-flow-arrow" aria-hidden>→</span></button>)}</div></section>
  <section className="bp-overview-team"><div className="bp-row-heading"><div><h2>People and responsibilities</h2></div><button onClick={()=>go('people')}>Explore the team →</button></div><div className="bp-person-strip">{data.people.map(p=><button key={p.id} onClick={()=>open('person',p.id)}><span className="bp-avatar">{p.initials}</span><span><strong>{p.name}</strong><small>{p.role}</small></span><span aria-hidden>↗</span></button>)}</div></section>
  <section><div className="bp-row-heading"><div><h2>The first project</h2></div><button onClick={()=>go('roadmap')}>View the roadmap →</button></div><div className="bp-first-project"><div><h3>{data.projects[0].title}</h3><p>{data.projects[0].description}</p><strong>{data.projects[0].outcome}</strong></div><div>{data.tasks.filter(t=>t.project===data.projects[0].id).map(t=><TaskButton key={t.id} task={t} data={data} open={open} />)}</div></div></section>
  <section className="bp-week-teaser"><div><h2>Weekly schedule</h2><p>The plan includes recurring reviews as well as project work. Open a week to see the owners, time allowances, and tasks together.</p><button onClick={()=>go('week')}>Explore a week →</button></div><div className="bp-rhythm">{data.tasks.filter(t=>t.repeat!==undefined).map(t=><button key={t.id} onClick={()=>open('task',t.id)}><span>{['MON','TUE','WED','THU','FRI','SAT','SUN'][t.repeat!]}</span><strong>{t.title}</strong><small>{t.minutes} min</small></button>)}</div></section>
 </>
}
function People({data,open}:{bp:Blueprint;data:Scenario;open:Open}) {return <><SectionTitle title="People and responsibilities" description="These fictional people make ownership visible. Names and staffing are examples, not employees to import." /><div className="bp-people-grid">{data.people.map(p=><button className="bp-person-card" key={p.id} onClick={()=>open('person',p.id)}><span className="bp-avatar">{p.initials}</span><small>Example person</small><h3>{p.name}</h3><strong>{p.role}</strong><p>{p.responsibility}</p><div><span>{p.hours} h/week capacity assumption</span><span>{data.tasks.filter(t=>t.person===p.id).length} task definitions →</span></div></button>)}</div><p className="bp-context-note">Task allowances describe only the work included here. They are not a complete staffing forecast or a fully booked calendar.</p></>}
function Roadmap({data,open}:{data:Scenario;open:Open}) {return <><SectionTitle title="Projects and milestones" description="Each project ends with a concrete outcome. Open a project or a milestone to inspect the tasks behind it." /><div className="bp-timeline" aria-label="Project timeline"><div className="bp-timeline-scale"><span>Day 1</span><span>Day {data.days}</span></div>{data.projects.map(p=>{ const ts=data.tasks.filter(t=>t.project===p.id); const start=Math.min(...ts.map(t=>t.day)); const end=ts.some(t=>t.repeat!==undefined)?data.days-1:Math.max(...ts.map(t=>t.day))+2; return <button key={p.id} onClick={()=>open('project',p.id)} aria-label={`${p.title}, day ${start+1} to ${end+1}`}><span>{p.title}</span><span className="bp-timeline-track"><span style={{left:`${start/data.days*100}%`,width:`${Math.max(2,(end-start+1)/data.days*100)}%`}} /></span></button>})}</div><div className="bp-roadmap">{data.projects.map(p=> {const tasks=data.tasks.filter(t=>t.project===p.id);const milestone=data.milestones.find(m=>m.project===p.id)!;return <article key={p.id}><div className="bp-roadmap-index"><small>Day {Math.min(...tasks.map(t=>t.day))+1}–{milestone.day+1}</small></div><div className="bp-roadmap-project"><button className="bp-text-button" onClick={()=>open('project',p.id)}><h3>{p.title} <span aria-hidden>↗</span></h3></button><p>{p.description}</p><div className="bp-roadmap-task-links">{tasks.map(t=><button key={t.id} onClick={()=>open('task',t.id)}>{t.title}</button>)}</div><button className="bp-milestone" onClick={()=>open('milestone',milestone.id)}><span aria-hidden>◇</span> {milestone.title}<small>Day {milestone.day+1}</small></button></div></article>})}</div></>}
function TaskButton({task,data,open}:{task:Scenario['tasks'][number];data:Scenario;open:Open}) {const person=data.people.find(p=>p.id===task.person);return <button className="bp-task-button" onClick={()=>open('task',task.id)}><span className="bp-task-square" aria-hidden /><span><strong>{task.title}</strong><small>{person?.name} · {task.minutes} min{task.repeat!==undefined?' · weekly':''}</small></span><span aria-hidden>↗</span></button>}
function Week({data,open,week,onWeek}:{data:Scenario;open:Open;week:number;onWeek:(w:number)=>void}) {
 const last=Math.ceil(data.days/7)
 const days=Array.from({length:Math.min(7,data.days-(week-1)*7)},(_,i)=>({index:i,day:(week-1)*7+i}))
 return <><SectionTitle title="Weekly schedule" description="A relative calendar, starting on an illustrative Monday. Recurring reviews begin once the weekly routine is established." /><div className="bp-week-controls"><button disabled={week===1} onClick={()=>onWeek(week-1)} aria-label="Previous week">←</button><label>Week <select aria-label="Week" value={week} onChange={e=>onWeek(Number(e.target.value))}>{Array.from({length:last},(_,i)=><option value={i+1} key={i}>{i+1}</option>)}</select><span> of {last}</span></label><button disabled={week===last} onClick={()=>onWeek(week+1)} aria-label="Next week">→</button><span>Days {(week-1)*7+1}–{Math.min(week*7,data.days)}</span></div><div className="bp-week-grid">{days.map(({index,day})=>{const tasks=data.tasks.filter(t=>t.repeat===undefined?t.day===day:day>=t.day && index===t.repeat);const milestones=data.milestones.filter(m=>m.day===day);return <div className="bp-day" key={day}><header><strong>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][index]}</strong><span>Day {day+1}</span></header>{tasks.map(t=><button key={t.id} className="bp-day-task" onClick={()=>open('task',t.id)}><strong>{t.title}</strong><span>{data.people.find(p=>p.id===t.person)?.name}</span><small>{t.minutes} min{t.repeat!==undefined?' · weekly':''}</small></button>)}{milestones.map(m=><button className="bp-day-milestone" key={m.id} onClick={()=>open('milestone',m.id)}>◇ {m.title}</button>)}{!tasks.length&&!milestones.length&&<p className="bp-day-empty">Unallocated</p>}</div>})}</div><p className="bp-context-note">Unallocated time is intentional. Customer work, travel, breaks, and local working arrangements are not automatically filled in. These schedules do not create calendar events.</p></>
}
function Tasks({data,open}:{data:Scenario;open:Open}) {
 const [query,setQuery]=useState('');const [person,setPerson]=useState('all');const [project,setProject]=useState('all')
 const tasks=data.tasks.filter(t=>(person==='all'||t.person===person)&&(project==='all'||t.project===project)&&`${t.title} ${t.detail}`.toLowerCase().includes(query.toLowerCase()))
 useEffect(()=>{if(person!=='all'&&!data.people.some(p=>p.id===person))setPerson('all');if(project!=='all'&&!data.projects.some(p=>p.id===project))setProject('all')},[data.people,data.projects,person,project])
 return <><SectionTitle title="Tasks" description="Inspect the work, who owns it, and what done means. These are the same tasks shown in the roadmap and weekly schedule." /><div className="bp-task-filters"><input type="search" aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={e=>setQuery(e.target.value)} /><select aria-label="Filter by person" value={person} onChange={e=>setPerson(e.target.value)}><option value="all">All people</option>{data.people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select aria-label="Filter by project" value={project} onChange={e=>setProject(e.target.value)}><option value="all">All projects</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.title}</option>)}</select><span role="status">{tasks.length} tasks</span></div><div className="bp-task-list">{tasks.map(t=><TaskButton key={t.id} task={t} data={data} open={open}/>)}</div>{!tasks.length&&<div className="bp-empty"><p>No tasks match these filters.</p><button onClick={()=>{setQuery('');setPerson('all');setProject('all')}}>Clear task filters</button></div>}</>
}
function Documents({bp,data,open}:{bp:Blueprint;data:Scenario;open:Open}) {return <><SectionTitle title="Documents" description="Read the strategy, examine the assumptions, and see how the budget illustration changes with the scenario."/><div className="bp-document-grid">{[{id:'plan',label:'Business plan',desc:bp.offer},{id:'research',label:'Research questions',desc:'What to investigate before applying this model to your own business.'},{id:'budget',label:'Budget plan & assumptions',desc:`+${money(data.totalIncome)} projected revenue vs -${money(data.totalExpenses)} expenses (+${money(data.netMargin)} net margin).`}].map(d=><button key={d.id} className="bp-document" onClick={()=>open('document',d.id)}><h3>{d.label}</h3><p>{d.desc}</p><span>Read document →</span></button>)}</div><p className="bp-context-note">These documents are editorial examples. Research questions are not research findings. Budget figures are synthetic planning assumptions, not quotes, forecasts, or a complete cost of running a business.</p></>}
function Inspector({bp,data,value,close,open}:{bp:Blueprint;data:Scenario;value:string;close:()=>void;open:Open}) {
 const dialog=useRef<HTMLDialogElement>(null)
 const [kind,id]=value.split(':')
 const task=data.tasks.find(t=>t.id===id), person=data.people.find(p=>p.id===id), project=data.projects.find(p=>p.id===id), milestone=data.milestones.find(m=>m.id===id)
 const exists=kind==='task'?!!task:kind==='person'?!!person:kind==='project'?!!project:kind==='milestone'?!!milestone:kind==='document'&&['plan','research','budget'].includes(id)
 const title=kind==='task'?task?.title:kind==='person'?person?.name:kind==='project'?project?.title:kind==='milestone'?milestone?.title: id==='budget'?'Budget plan & assumptions':id==='research'?'Operational validation questions':'Operating model & business plan'
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close()},[])
 return <dialog ref={dialog} className="bp-inspector" aria-labelledby="bp-inspector-title" onCancel={e=>{e.preventDefault();close()}} onClick={e=>{if(e.target===e.currentTarget) {const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)close()}}}>
  <div className="bp-inspector-top"><span>{data.label}</span><button autoFocus onClick={close} aria-label="Close detail">×</button></div><h2 id="bp-inspector-title">{exists?title:'Detail not available'}</h2>
  {!exists?<p>This record is not part of the selected scenario.</p>:<>
   {kind==='task'&&task&&<><p className="bp-detail-lead">{task.detail}</p><h3>Done means</h3><p>{task.outcome}</p><div className="bp-detail-facts"><div><span>Owner</span><button onClick={()=>open('person',task.person)}>{data.people.find(p=>p.id===task.person)?.name} →</button></div><div><span>Project</span><button onClick={()=>open('project',task.project)}>{data.projects.find(p=>p.id===task.project)?.title} →</button></div><div><span>Time allowance</span><strong>{task.minutes} minutes</strong></div><div><span>Schedule</span><strong>{task.repeat!==undefined?`Weekly on ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][task.repeat]}, after day ${task.day+1}`:`Day ${task.day+1}`}</strong></div></div><p className="bp-context-note">Read-only example. Opening this task does not add it to your workspace.</p></>}
   {kind==='person'&&person&&<><div className="bp-detail-person"><span className="bp-avatar">{person.initials}</span><div><strong>{person.role}</strong><p>Fictional person · {person.hours} hours/week assumed capacity</p></div></div><h3>Responsibilities</h3><p>{person.responsibility}</p><h3>Work owned by {person.name.split(' ')[0]}</h3>{data.tasks.filter(t=>t.person===person.id).map(t=><TaskButton key={t.id} task={t} data={data} open={open}/>)}</>}
   {kind==='project'&&project&&<><p className="bp-detail-lead">{project.description}</p><h3>Project outcome</h3><p>{project.outcome}</p><h3>Tasks</h3>{data.tasks.filter(t=>t.project===project.id).map(t=><TaskButton key={t.id} task={t} data={data} open={open}/>)}</>}
   {kind==='milestone'&&milestone&&<><p className="bp-detail-lead">Planned outcome · Day {milestone.day+1}</p><p>This milestone is reached when the project output is reviewed and accepted. It is not automatically completed by the passage of time.</p><button className="bp-inline-link" onClick={()=>open('project',milestone.project)}>Inspect the project and its tasks →</button></>}
   {kind==='document'&&id==='plan'&&<div className="bp-document-body"><p className="bp-detail-lead">{bp.intro}</p><h3>Operating structure & delivery cadence</h3><p>{bp.principle}</p><h3>Service scope & commercial deliverables</h3><p>{bp.offer}</p><h3>Capacity management & constraints</h3><p>{bp.tradeoff}</p><h3>Business development & client acquisition</h3><p>{bp.acquisition}</p><h3>90-day starter operational focus</h3><p>{data.summary}</p><h3>Milestone review points</h3>{data.milestones.map(m=><button className="bp-document-ref" key={m.id} onClick={()=>open('milestone',m.id)}>Day {m.day+1} · {m.title} →</button>)}</div>}
   {kind==='document'&&id==='research'&&<div className="bp-document-body"><p className="bp-detail-lead">Operational validation questions for prospective operators. Every assumption below should be verified against local market conditions before applying this model.</p><h3>Market pricing & client qualification</h3><p>Do prospective clients in your target segment readily accept fixed-scope milestone pricing or monthly retainers? Verify average contract value and procurement review cycles with at least five target decision-makers.</p><h3>Weekly capacity & time allocations</h3><p>Can the primary deliverables be reliably completed within the planned weekly delivery hours? Track actual delivery time, revision rounds, and client coordination overhead to ensure non-billable administrative hours do not exceed 25% of total time.</p><h3>Regulatory compliance & commercial governance</h3><p>What jurisdiction-specific requirements govern your operations? Confirm professional liability insurance, vendor licensing, local tax withholding, and independent contractor classification regulations before executing client agreements.</p><h3>Working capital & cashflow buffer</h3><p>Given typical 15- to 30-day payment terms on milestone invoices, does the business possess sufficient initial cash reserves to sustain operating software, contractor disbursements, and personal living expenses during the first 60 days?</p></div>}
   {kind==='document'&&id==='budget'&&<div className="bp-document-body">
     <p className="bp-detail-lead">{data.label} · USD · dual-sided operational budget plan</p>
     <div className="bp-budget-summary-chips">
       <div className="bp-budget-stat-chip income">
         <small>Projected Income</small>
         <strong>+{money(data.totalIncome)}</strong>
       </div>
       <div className="bp-budget-stat-chip expense">
         <small>Planned Expenses</small>
         <strong>-{money(data.totalExpenses)}</strong>
       </div>
       <div className="bp-budget-stat-chip net">
         <small>Net Margin</small>
         <strong>+{money(data.netMargin)}</strong>
       </div>
     </div>

     <h3 className="bp-budget-group-heading">Projected Income Streams</h3>
     <div className="bp-budget-lines">
       {data.budget.filter(b => b.direction === 'income').map(b => (
         <div key={b.label} className="bp-budget-line-row income">
           <span>
             <div className="bp-budget-line-title">
               <strong>{b.label}</strong>
               <span className="bp-budget-badge income">{BUDGET_CATEGORIES[b.category] || b.category}</span>
               {b.taskKey && <button className="bp-budget-task-link" onClick={() => open('task', b.taskKey!)}>Linked task →</button>}
             </div>
             <small>{b.note}</small>
           </span>
           <strong className="bp-budget-amount income">+{money(b.amount)}</strong>
         </div>
       ))}
     </div>

     <h3 className="bp-budget-group-heading">Planned Operating Expenses</h3>
     <div className="bp-budget-lines">
       {data.budget.filter(b => b.direction === 'expense').map(b => (
         <div key={b.label} className="bp-budget-line-row expense">
           <span>
             <div className="bp-budget-line-title">
               <strong>{b.label}</strong>
               <span className="bp-budget-badge expense">{BUDGET_CATEGORIES[b.category] || b.category}</span>
               {b.taskKey && <button className="bp-budget-task-link" onClick={() => open('task', b.taskKey!)}>Linked task →</button>}
             </div>
             <small>{b.note}</small>
           </span>
           <strong className="bp-budget-amount expense">{b.amount === 0 ? '$0' : `-${money(b.amount)}`}</strong>
         </div>
       ))}
     </div>

     <div className="bp-budget-net-bar">
       <div>
         <span>Projected Operating Margin</span>
         <small>Operating contribution before owner salary, facility premises, and corporate taxes.</small>
       </div>
       <strong>+{money(data.netMargin)} USD</strong>
     </div>

     <h3>Accounting & Desk Integration</h3>
     <p>These structured budget entries represent the initial operational accounting model. When configured in a workspace, these items map directly to the Desk <strong>Lists → Budget</strong> table with daily cashflow impacts on the Calendar view.</p>

     <h3>What these numbers mean</h3>
     <p>These figures are illustrative operating planning figures for the selected {data.label.toLowerCase()} horizon, showing realistic unit economics and service deliverable margins.</p>
     <h3>What is excluded</h3>
     <p>Owner draws/dividends, premises rent, local insurance, regulatory filing fees, and corporate income taxes are excluded from this baseline illustration.</p>
     <p className="bp-context-note">Blueprint budgets provide structural business model guidance. Opening or inspecting a blueprint does not create live transactions in your active workspace.</p>
   </div>}
  </>}
 </dialog>
}
