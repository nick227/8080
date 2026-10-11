import type { BudgetCategoryKey, BudgetDirectionKey } from '@project/shared'

// Editorial source data for the Reader. This is deliberately not the external import schema.
export type Horizon = '90'
export type Person = { id: string; name: string; role: string; initials: string; responsibility: string; hours: number; from: number }
export type Task = { id: string; title: string; detail: string; outcome: string; person: string; project: string; minutes: number; repeat?: number; from: number }
export type Project = { id: string; title: string; description: string; outcome: string; from: number }
export type BlueprintBudgetItem = {
  key?: string
  label: string
  amount: number
  note: string
  direction: BudgetDirectionKey
  category: BudgetCategoryKey
  taskKey?: string
}
export type Blueprint = {
  slug: string; type: string; title: string; subtitle: string; description: string; image: string; accent: string; specialization: string;
  intro: string; principle: string; tradeoff: string; offer: string; acquisition: string; people: Person[]; projects: Project[]; tasks: Task[];
  scenarios: Record<Horizon, { label: string; summary: string; capacity: string; budget: BlueprintBudgetItem[] }>
}
type TaskRow = [string, string, string, string, number, number?]
function projectTasks(project: string, from: number, rows: TaskRow[]): Task[] {
  return rows.map(([title, person, detail, outcome, minutes, repeat], i) => ({ id: `${project}-${i + 1}`, project, title, person, detail, outcome, minutes, repeat, from }))
}
const person = (id: string, name: string, role: string, responsibility: string, hours: number, from = 90): Person => ({ id, name, role, responsibility, hours, from, initials: name.split(' ').map(n => n[0]).join('') })
const project = (id: string, title: string, description: string, outcome: string, from = 90): Project => ({ id, title, description, outcome, from })
const item = (
  label: string,
  amount: number,
  note: string,
  direction: BudgetDirectionKey,
  category: BudgetCategoryKey,
  taskKey?: string,
  key?: string,
): BlueprintBudgetItem => ({
  label,
  amount,
  note,
  direction,
  category,
  taskKey,
  key: key || label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
})

export const blueprints: Blueprint[] = [
  {
    slug: 'solo-operator',
    type: 'Solo Operator',
    title: 'Solo Operator',
    subtitle: 'A structured 90-day operating model for an independent specialized consultancy.',
    image: 'solo-desk',
    accent: '#b77b46',
    specialization: 'Independent professional services & consulting',
    description: 'An independent practitioner balances business development, client delivery, invoicing, and operational administration with external bookkeeping support.',
    intro: 'Independent service practices frequently struggle with revenue volatility caused by alternating between heads-down delivery and frantic business development. This 90-day starter operational blueprint establishes a repeatable operating cadence that integrates client qualification, milestone delivery, weekly billing, and cashflow oversight into a sustainable 38-hour work week.',
    principle: 'The practice operates on a protected four-day client delivery schedule with Friday mornings reserved for invoicing, account reconciliation, and pipeline follow-ups. Client engagements are structured around clearly defined milestones rather than open-ended hourly billing, enabling the operator to manage two concurrent client deliverables without compromising quality or turnaround time.',
    offer: 'The core service offering consists of fixed-scope strategic advisory projects and ongoing monthly retainer agreements. Every client engagement begins with a paid diagnostic discovery deliverable that establishes baseline requirements, followed by structured implementation phases producing tangible documentation, architectural roadmaps, and executive reviews.',
    tradeoff: 'Because a solo practitioner cannot scale delivery hours without degrading service quality, growth is driven by increasing engagement value rather than taking on unmanageable client volume. The operator preserves 10 hours weekly for business development and administrative rigor, ensuring that active client delivery does not starve future pipeline.',
    acquisition: 'Client acquisition relies on direct executive networking, targeted outbound outreach to qualified prospects, and scheduled quarterly check-ins with past clients. Inbound inquiries are evaluated against a written qualification scorecard before any discovery meeting is booked, preventing unpaid scoping and unvetted proposal drafting.',
    people: [
      person('owner', 'Alex Morgan', 'Lead Consultant & Practice Owner', 'Qualifies client inquiries, executes primary advisory deliverables, leads business development, and directs practice strategy.', 32),
      person('finance', 'Jordan Vance', 'Bookkeeper & Administrative Specialist', 'Reconciles weekly banking transactions, issues monthly invoices, tracks accounts receivable aging, and assists with tax compliance.', 6),
    ],
    projects: [
      project('position', 'Practice Positioning & Commercial Terms', 'Formalize engagement agreements, rate card structure, and client fit criteria.', 'Executed service agreement template and fee schedule.'),
      project('intake', 'Client Intake & Discovery Workflow', 'Build a structured intake system to qualify and onboard prospective clients.', 'Standardized qualification scorecard and onboarding brief.'),
      project('delivery', 'Milestone Delivery & Quality Standards', 'Execute client deliverables with consistent check-ins and formal handovers.', 'Completed advisory deliverable package and sign-off record.'),
      project('billing', 'Commercial Operations & Cashflow Routine', 'Establish a dependable weekly billing, collection, and bookkeeping routine.', 'Reconciled accounting ledger and 30-day cashflow forecast.'),
      project('pipeline', 'Business Development & Client Retention', 'Maintain active prospect relationships and capture post-engagement referrals.', 'Operational pipeline tracker and client case study repository.'),
    ],
    tasks: [
      ...projectTasks('position', 90, [
        ['Standardize master services agreement and scope terms', 'owner', 'Draft reusable contract terms covering intellectual property, payment milestones, and out-of-scope requests.', 'A signed master services agreement template with clear boundaries.', 90],
        ['Establish engagement pricing and retainer schedules', 'owner', 'Define fixed-fee project milestone rates and recurring monthly advisory tiers.', 'A published fee schedule with minimum engagement thresholds.', 60],
        ['Define ideal client qualification criteria', 'owner', 'Specify budget thresholds, decision-maker authority, and technical criteria required for prospective accounts.', 'A written client-fit rubric used during initial screening.', 45],
      ]),
      ...projectTasks('intake', 90, [
        ['Build inbound inquiry qualification scorecard', 'owner', 'Create a structured screening form to assess project scope, deadline feasibility, and budget alignment.', 'A qualification scorecard attached to CRM contact records.', 60],
        ['Prepare client discovery workshop agenda', 'owner', 'Structure a two-hour discovery session agenda to surface goals, technical constraints, and success metrics.', 'A reusable discovery facilitation guide and notes template.', 75],
        ['Create formal proposal and statement of work template', 'owner', 'Assemble a standardized proposal layout with executive summary, deliverables, timeline, and fee schedule.', 'A modular proposal document ready for client presentation.', 90],
        ['Conduct client onboarding and access checklist', 'owner', 'Gather necessary credentials, stakeholder contacts, and source assets before commencing project work.', 'A completed onboarding package with verified project access.', 45],
      ]),
      ...projectTasks('delivery', 90, [
        ['Establish weekly delivery progress check-in', 'owner', 'Conduct a bi-weekly written progress update covering completed milestones, upcoming tasks, and decisions needed.', 'A documented status report dispatched to client sponsors.', 45, 0],
        ['Develop primary advisory deliverable draft', 'owner', 'Execute research, system analysis, and recommendation chapters according to agreed statement of work.', 'A complete first-draft advisory deliverable submitted for review.', 180],
        ['Facilitate deliverable review session', 'owner', 'Present deliverable findings to client executive stakeholders and document revision requests.', 'Recorded stakeholder feedback notes and agreed adjustments.', 60],
        ['Finalize deliverable handover package', 'owner', 'Incorporate client feedback, package final documentation assets, and secure written deliverable sign-off.', 'A signed deliverable acceptance record and archived asset package.', 90],
      ]),
      ...projectTasks('billing', 90, [
        ['Issue deposit and milestone invoices', 'finance', 'Generate and dispatch project milestone invoices upon contract signing and deliverable milestones.', 'Dispatched invoice records logged in accounting ledger.', 45],
        ['Review weekly time allocation and expense log', 'owner', 'Verify hours spent against project milestones and categorize operational software and travel receipts.', 'An audited weekly time and expense report.', 30, 4],
        ['Reconcile bank accounts and track receivables aging', 'finance', 'Match bank deposits against open invoices, follow up on outstanding balances past 15 days, and log payments.', 'Updated accounts receivable ledger with zero unallocated receipts.', 45, 4],
        ['Compile monthly profit and loss summary', 'finance', 'Review gross billings, operational software expenses, and net margin performance against quarterly targets.', 'A monthly financial summary report reviewed by the practice owner.', 60],
      ]),
      ...projectTasks('pipeline', 90, [
        ['Conduct quarterly outbound relationship outreach', 'owner', 'Contact 10 targeted prospective enterprise accounts with relevant industry insights and practice capabilities.', 'Logged outreach notes and scheduled exploratory conversations.', 60, 2],
        ['Conduct post-engagement client feedback interview', 'owner', 'Interview completed project sponsors to evaluate satisfaction, identify improvements, and request referrals.', 'Documented client feedback score and authorized testimonial quote.', 45],
        ['Publish engagement case study summary', 'owner', 'Anonymize client data and author a concise case study highlighting the problem, methodology, and verified business outcome.', 'A published case study asset added to sales collateral.', 90],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Establish an independent practice with two active client engagements, weekly financial administration, and a sustainable 38-hour routine.',
        capacity: 'Alex Morgan (32h/wk) · Jordan Vance (6h/wk)',
        budget: [
          item('Strategic client retainers', 18000, 'Three recurring advisory accounts at $6,000 per quarter.', 'income', 'client_retainer', 'delivery-1'),
          item('Fixed-scope project engagements', 12000, 'Two milestone-based consulting diagnostics delivered during the quarter.', 'income', 'project_fee', 'delivery-2'),
          item('Paid discovery sessions', 3000, 'Initial paid diagnostic discovery sessions for prospective accounts.', 'income', 'consulting', 'intake-2'),
          item('Practice software & cloud tools', 360, 'Subscriptions for CRM, proposal software, cloud storage, and video conferencing.', 'expense', 'software_tools', 'position-1'),
          item('Client presentation collateral & assets', 250, 'Branded diagnostic workbook production, templates, and presentation assets.', 'expense', 'materials_cogs', 'intake-3'),
          item('Bookkeeping & compliance support', 1200, 'Jordan Vance administrative and weekly accounts reconciliation support.', 'expense', 'contractor_support', 'billing-3'),
        ],
      },
    },
  },
  {
    slug: 'lean-service-team',
    type: 'Lean Service Team',
    title: 'Lean Service Team',
    subtitle: 'A 90-day operational blueprint for a multi-person commercial field service and property maintenance firm.',
    image: 'interiors',
    accent: '#658371',
    specialization: 'Commercial facilities & property operations',
    description: 'A four-person service team coordinates field dispatch, service execution, photo quality audits, customer billing, and equipment maintenance.',
    intro: 'Multi-person service firms encounter operational failure when field handoffs are ambiguous, daily dispatch routes lack travel buffers, or client billing lags behind completed field work. This 90-day starter operational blueprint establishes clear separation between office dispatch, on-site technical execution, and billing administration, supporting profitable commercial property contracts with documented proof of service.',
    principle: 'The service workflow adheres to a strict three-phase standard: office coordination confirms job scope, site access codes, and safety requirements 48 hours prior to dispatch; field technicians perform maintenance according to written site checklists and record timestamped photo logs; and office administration reviews completion notes and issues customer invoices within 24 hours of job completion.',
    offer: 'The firm provides recurring commercial facility maintenance agreements, seasonal property turnovers, and scheduled mechanical inspections. Every commercial service contract specifies included tasks, service frequencies, guaranteed arrival windows, and consumable supply allowances, with digital completion reports delivered directly to commercial property managers.',
    tradeoff: 'Field service capacity is tightly constrained by technician travel times, equipment maintenance cycles, and property access delays. The dispatch coordinator enforces a mandatory 25% schedule buffer across daily route assignments rather than booking technicians to theoretical maximums, preventing cascade delays and ensuring consistent arrival times.',
    acquisition: 'Business development targets regional commercial property management firms, medical facility directors, and retail portfolio operators. Commercial agreements are secured by conducting paid facility condition audits that expose deferred maintenance liabilities and establish predictable quarterly service maintenance budgets.',
    people: [
      person('coordinator', 'Sam Rivera', 'Operations & Dispatch Coordinator', 'Manages client work orders, maps technician dispatch schedules, coordinates site access, and monitors field job status.', 36),
      person('lead', 'Jo Bennett', 'Field Operations Lead', 'Directs on-site service delivery, enforces technical safety standards, performs quality spot-checks, and trains technicians.', 38),
      person('technician', 'Taylor Chen', 'Senior Service Technician', 'Carries out scheduled field maintenance, documents digital completion logs, captures site photos, and logs consumable usage.', 38),
      person('admin', 'Morgan Diaz', 'Office Manager & Finance Admin', 'Generates customer billing, processes vendor invoices, manages inventory purchasing, and tracks receivables.', 20),
    ],
    projects: [
      project('operations', 'Territory Mapping & Service Standards', 'Define geographic dispatch zones, standard operating procedures, and safety protocols.', 'A comprehensive operations manual and service tier catalog.'),
      project('dispatch', 'Dispatch Workflow & Site Access System', 'Establish client work-order intake, access credential tracking, and routing procedures.', 'Standardized job dispatch schedule and site access repository.'),
      project('field', 'Field Execution & Quality Assurance', 'Execute scheduled service visits with photo verification and digital sign-off.', 'Verified service completion records and customer sign-off archive.'),
      project('billing', 'Commercial Closeout & Receivables Management', 'Enforce 24-hour job invoicing, supplier reconciliations, and receivables aging oversight.', 'Closed job billing ledger and 30-day cashflow summary.'),
      project('fleet', 'Equipment Maintenance & Inventory Control', 'Maintain power tools, service vehicles, safety gear, and consumable stock par levels.', 'Audited inventory register and vehicle service maintenance log.'),
    ],
    tasks: [
      ...projectTasks('operations', 90, [
        ['Map geographic service zones and travel buffers', 'coordinator', 'Divide territory into primary and secondary service zones with defined travel time allowances.', 'A territorial service zone map with dispatch travel rules.', 60],
        ['Codify standard operating procedures for core services', 'lead', 'Document step-by-step technical procedures, required tools, and completion criteria for standard maintenance packages.', 'A standard operating procedures manual for field technicians.', 90],
        ['Establish field safety and hazard inspection checklist', 'lead', 'Create a pre-work safety inspection protocol covering electrical isolation, protective gear, and hazardous materials.', 'A mandatory pre-job safety checklist embedded in mobile work orders.', 60],
      ]),
      ...projectTasks('dispatch', 90, [
        ['Build commercial work-order intake and access template', 'coordinator', 'Design a digital intake form capturing site gate codes, property manager contacts, and special access constraints.', 'A standardized work-order brief ready for technician dispatch.', 60],
        ['Implement weekly route dispatch schedule', 'coordinator', 'Schedule recurring maintenance routes grouped by geographic cluster with built-in traffic buffers.', 'A balanced weekly route schedule with assigned primary and backup technicians.', 45, 0],
        ['Confirm 48-hour site access credentials', 'coordinator', 'Contact property managers 48 hours prior to scheduled visits to confirm gate codes, parking, and building access.', 'Verified site access confirmations logged in work-order records.', 30, 2],
      ]),
      ...projectTasks('field', 90, [
        ['Conduct scheduled commercial maintenance visit', 'technician', 'Execute specified maintenance checklist on-site, test mechanical components, and inspect safety sensors.', 'Completed on-site maintenance checklist with equipment readings.', 150],
        ['Capture digital photo-verification and exception log', 'technician', 'Photograph serviced equipment and note any deferred maintenance or required replacement components.', 'Timestamped photo-verification record uploaded to job file.', 30],
        ['Perform unannounced field quality audit', 'lead', 'Conduct on-site quality spot-checks on 10% of completed jobs to evaluate technician workmanship and protocol adherence.', 'An audited quality inspection score logged in technician performance review.', 60, 3],
        ['Obtain digital customer job completion sign-off', 'technician', 'Review completed tasks with on-site facility representative and capture digital sign-off signature.', 'A signed digital completion note confirming satisfactory delivery.', 30],
      ]),
      ...projectTasks('billing', 90, [
        ['Process 24-hour job completion billing batch', 'admin', 'Review completed work orders, match inventory consumed, and dispatch invoices to property managers within 24 hours.', 'Dispatched customer invoices linked to verified completion photos.', 60, 4],
        ['Reconcile vendor supply invoices and subcontractor costs', 'admin', 'Match supplier material receipts against specific client work orders and verify trade contractor rates.', 'Reconciled job costing ledger with allocated material expenses.', 60],
        ['Review aged receivables and issue payment reminders', 'admin', 'Audit 30-day receivables ledger, issue automated payment statements, and contact delinquent property accounts.', 'An updated receivables status report with zero accounts over 45 days.', 45, 4],
        ['Conduct monthly contract profitability and margin audit', 'admin', 'Compare labor hours and consumables consumed against contractual retainer revenues per commercial property.', 'A property-by-property gross margin contribution report.', 75],
      ]),
      ...projectTasks('fleet', 90, [
        ['Audit consumable stock par levels and issue reorders', 'admin', 'Check physical stock of replacement filters, lubricants, and hardware consumables against minimum par levels.', 'Processed purchase orders maintaining safe consumable stock.', 45, 1],
        ['Perform weekly vehicle and safety equipment inspection', 'lead', 'Inspect service vehicle fluid levels, tire condition, ladder mounts, first-aid kits, and electrical testers.', 'A signed weekly vehicle and safety inspection certification.', 45, 4],
        ['Conduct quarterly commercial client service review', 'coordinator', 'Meet with facility directors to review quarterly maintenance reports, address exceptions, and present contract renewals.', 'Documented quarterly client review notes and approved service renewals.', 60],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Four-person service operations managing 8 recurring commercial property contracts, daily route dispatch, and 24-hour job billing.',
        capacity: 'Four roles · 132 combined hours/week',
        budget: [
          item('Commercial property maintenance agreements', 48000, 'Scheduled quarterly maintenance contracts across 8 commercial facility accounts.', 'income', 'client_retainer', 'field-1'),
          item('Specialty repair & turnover work orders', 16000, 'On-demand commercial service calls and seasonal facility preparation projects.', 'income', 'project_fee', 'field-2'),
          item('Facility condition assessments & audits', 3500, 'Paid technical inspection audits for prospective commercial property managers.', 'income', 'consulting', 'operations-1'),
          item('Field consumables & equipment upkeep', 2400, 'Replacement filters, hardware consumables, safety supplies, and tool servicing.', 'expense', 'materials_cogs', 'fleet-1'),
          item('Dispatch, routing & mobile software', 540, 'Mobile work-order app, dispatch routing software, and GPS vehicle tracking.', 'expense', 'software_tools', 'dispatch-2'),
          item('Licensed trade contractor reserve', 3200, 'Subcontracted licensed trade assistance for specialized electrical/HVAC work.', 'expense', 'contractor_support', 'billing-2'),
          item('Service fleet fuel & operational costs', 2800, 'Field vehicle fuel, parking permits, and regular fluid maintenance.', 'expense', 'travel_hospitality', 'fleet-2'),
          item('Office admin, billing & accounting tools', 360, 'Commercial invoicing software, merchant processing, and compliance filings.', 'expense', 'legal_admin', 'billing-1'),
        ],
      },
    },
  },
  {
    slug: 'project-studio',
    type: 'Project Studio',
    title: 'Project Studio',
    subtitle: 'A 90-day operational blueprint for a digital product design and technology studio.',
    image: 'studio',
    accent: '#758aa7',
    specialization: 'Digital product design & technology consultancy',
    description: 'A five-person studio manages client pipelines, staged milestone sprints, design system delivery, and commercial project governance.',
    intro: 'Design and technical consultancies suffer margin collapse when project scope creeps without adjustment, client review rounds drag on without decisions, or producers over-commit studio capacity. This 90-day starter operational blueprint establishes structured sprint checkpoints, formal acceptance gates, consolidated stakeholder feedback cycles, and rigorous milestone invoicing to keep delivery profitable, predictable, and calm.',
    principle: 'The studio runs two concurrent delivery tracks structured in two-week milestone sprints. Each sprint begins with an agreed brief and measurable acceptance criteria, followed by mid-sprint design reviews and formal milestone presentations. Feedback must be consolidated by a designated client executive sponsor within three business days, preventing contradictory stakeholder requests and production bottlenecks.',
    offer: 'The studio delivers scoped digital product design, multi-platform design systems, and interactive application prototypes. Commercial engagements are defined by written technical specifications rather than open-ended time allowances, with explicit boundaries covering revision cycles, production asset packaging, and post-launch technical warranty support.',
    tradeoff: 'Production quality deteriorates rapidly when creative and engineering team members context-switch across more than two concurrent engagements. The studio enforces a strict maximum of two active client delivery projects per maker, requiring subsequent client engagements to join a scheduled start queue rather than overlapping active sprints.',
    acquisition: 'Business development is managed by the executive producer through inbound portfolio case studies, technology partner referrals, and scheduled quarterly capability presentations to product leaders. Formal proposals are submitted only after a paid technical scoping workshop, ensuring accurate effort estimation and mutually agreed scope boundaries.',
    people: [
      person('producer', 'Morgan Lee', 'Executive Producer & Account Director', 'Directs client relationships, negotiates commercial contracts, manages sprint schedules, and monitors project profitability.', 34),
      person('director', 'Avery Stone', 'Design Director', 'Sets creative direction, chairs design critique reviews, enforces system token architecture, and leads client presentations.', 36),
      person('maker', 'Jamie Park', 'Senior Designer & Systems Maker', 'Builds design tokens, Figma component systems, interactive prototypes, and production delivery packages.', 36),
      person('engineer', 'Drew Quinn', 'Technical Implementation Specialist', 'Develops front-end application prototypes, audits technical feasibility, and verifies API architecture.', 28),
      person('finance', 'Elena Rostova', 'Studio Operations & Finance Manager', 'Dispatches milestone invoices, tracks studio burn rate, processes contractor disbursements, and audits project margins.', 14),
    ],
    projects: [
      project('commercial', 'Commercial Framework & Scope Governance', 'Establish Master Services Agreements, Statement of Work templates, and revision policies.', 'Standardized commercial contract package and project rate card.'),
      project('discovery', 'Discovery Workshop & Requirements System', 'Run structured technical discovery sessions and author acceptance matrices.', 'Completed project charter, technical specification, and milestone roadmap.'),
      project('sprints', 'Staged Sprint Execution & Design Reviews', 'Execute two-week design sprints with mid-point reviews and client demonstrations.', 'Approved component libraries, design system tokens, and interactive prototypes.'),
      project('handover', 'Technical QA & Client Deliverable Handover', 'Package production files, run accessibility audits, and secure written sign-off.', 'Verified deliverable repository and formal acceptance certificate.'),
      project('finance', 'Studio Financials & Business Development', 'Manage milestone cashflow, reconcile project margins, and maintain the sales pipeline.', 'Audited studio margin ledger and active sales pipeline tracker.'),
    ],
    tasks: [
      ...projectTasks('commercial', 90, [
        ['Standardize studio Master Services Agreement and SOW templates', 'producer', 'Draft contract terms governing intellectual property transfer, milestone billing, and change orders.', 'A signed Master Services Agreement template and Statement of Work schedule.', 90],
        ['Define client revision rules and out-of-scope rate cards', 'producer', 'Specify included revision rounds per milestone and establish hourly rates for out-of-scope feature requests.', 'A written scope governance policy included in all client proposals.', 60],
        ['Establish project profitability and resource allocation model', 'finance', 'Model studio overhead, maker capacity, and minimum acceptable project gross margin targets.', 'A project financial calculator used for all prospective engagements.', 60],
      ]),
      ...projectTasks('discovery', 90, [
        ['Conduct client discovery and technical architecture workshop', 'producer', 'Facilitate a structured full-day workshop to define user personas, technical integrations, and business KPIs.', 'A documented workshop summary capturing technical constraints and goals.', 120],
        ['Author project charter and deliverable acceptance criteria', 'director', 'Write detailed acceptance criteria for every sprint milestone, defining explicit tests for completion.', 'A signed project charter with objective deliverable acceptance criteria.', 90],
        ['Build technical feasibility and dependency matrix', 'engineer', 'Evaluate third-party APIs, database schemas, and front-end performance constraints before design kickoff.', 'A technical feasibility brief identifying potential delivery risks.', 75],
      ]),
      ...projectTasks('sprints', 90, [
        ['Hold weekly studio delivery and resourcing review', 'producer', 'Review sprint burndown, remove maker roadblocks, and verify milestone deadlines across active projects.', 'An updated sprint board with confirmed owner allocations.', 45, 0],
        ['Construct design system component library and token architecture', 'maker', 'Design reusable typography, color tokens, and responsive UI components in Figma with accessibility checks.', 'A published design system library ready for prototype integration.', 180],
        ['Develop interactive technical prototype', 'engineer', 'Build functional front-end prototype demonstrating user flows, state management, and responsive layouts.', 'An interactive web prototype deployed to private client staging environment.', 150],
        ['Conduct bi-weekly client sprint milestone demonstration', 'director', 'Present sprint deliverables to client stakeholders and review adherence to agreed acceptance criteria.', 'A recorded milestone demonstration with formal feedback notes.', 60, 3],
        ['Consolidate client revision requests into sprint backlog', 'producer', 'Review feedback against statement of work, filter out-of-scope suggestions, and schedule approved revisions.', 'A prioritized revision backlog approved by the client sponsor.', 45, 4],
      ]),
      ...projectTasks('handover', 90, [
        ['Run pre-handover accessibility and responsiveness audit', 'engineer', 'Audit deliverable components against WCAG AA standards and test rendering across mobile and desktop viewports.', 'An accessibility and responsiveness compliance report.', 60],
        ['Package production asset files and developer documentation', 'maker', 'Export SVGs, design tokens, iconography packages, and author developer handoff notes in Figma.', 'A complete production asset package ready for client engineering handoff.', 120],
        ['Secure formal client deliverable acceptance certificate', 'producer', 'Conduct final delivery walkthrough with client sponsor and secure signed milestone acceptance documentation.', 'A countersigned milestone acceptance certificate.', 45],
      ]),
      ...projectTasks('finance', 90, [
        ['Dispatch staged milestone invoice upon milestone approval', 'finance', 'Generate and dispatch milestone invoice upon receipt of deliverable acceptance certificate.', 'Dispatched invoice records matched to banking ledger.', 45],
        ['Reconcile contractor disbursements and project expenses', 'finance', 'Review specialist contractor time logs against project budget allocations and approve disbursements.', 'Reconciled project expense report with contractor invoice receipts.', 45, 4],
        ['Conduct monthly studio margin and burn rate review', 'finance', 'Evaluate realized gross margin per client project against target 65% studio operating contribution.', 'A monthly financial review report presented to studio leadership.', 60],
        ['Conduct quarterly prospective client capabilities presentation', 'producer', 'Present studio methodology and case studies to two enterprise product and design leadership teams.', 'Scheduled executive meetings with qualified enterprise prospects.', 75],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Five-person digital product studio delivering two concurrent milestone contracts with rigorous scope governance and 65%+ gross margin.',
        capacity: 'Five roles · 148 combined hours/week',
        budget: [
          item('Milestone digital product contracts', 72000, 'Two comprehensive product design and design system contracts at $36,000 each.', 'income', 'project_fee', 'sprints-2'),
          item('Strategic design advisory retainers', 18000, 'Two quarterly brand governance and design advisory retainers at $9,000 each.', 'income', 'client_retainer', 'commercial-1'),
          item('Paid technical discovery workshops', 6000, 'Two upfront scoping and specification workshops preceding major client builds.', 'income', 'consulting', 'discovery-1'),
          item('Creative software licenses & cloud tools', 1440, 'Figma Organization, GitHub Enterprise, cloud prototype hosting, and project boards.', 'expense', 'software_tools', 'commercial-1'),
          item('Interactive prototype staging & assets', 600, 'Staging infrastructure, commercial typography licenses, and presentation collateral.', 'expense', 'materials_cogs', 'sprints-3'),
          item('Specialist contractor & sound engineering', 5400, 'External specialist developers for custom WebGL shaders and animation audits.', 'expense', 'contractor_support', 'handover-1'),
          item('Legal, contract governance & accounting', 900, 'Contract legal review, commercial insurance, and quarterly accounting filings.', 'expense', 'legal_admin', 'finance-1'),
        ],
      },
    },
  },
]

export const horizons: Horizon[] = ['90']

export function scenarioData(bp: Blueprint, horizon: Horizon = '90') {
  const days = 90
  const projects = bp.projects.filter(p => p.from <= days)
  const people = bp.people.filter(p => p.from <= days)
  const tasks = bp.tasks.filter(t => t.from <= days).map(t => {
    const index = projects.findIndex(p => p.id === t.project)
    const local = bp.tasks.filter(x => x.project === t.project).findIndex(x => x.id === t.id)
    const projectStart = [0, 8, 18, 32, 48][index] ?? 20
    return { ...t, day: Math.min(88, projectStart + local * 3) }
  })
  const milestones = projects.map(p => ({
    id: `milestone-${p.id}`,
    project: p.id,
    title: p.outcome,
    day: Math.min(89, Math.max(...tasks.filter(t => t.project === p.id).map(t => t.day)) + 2),
  }))
  const scenario = bp.scenarios['90']
  const totalIncome = scenario.budget.filter(b => b.direction === 'income').reduce((s, b) => s + b.amount, 0)
  const totalExpenses = scenario.budget.filter(b => b.direction === 'expense').reduce((s, b) => s + b.amount, 0)
  const netMargin = totalIncome - totalExpenses
  return { days, projects, people, tasks, milestones, totalIncome, totalExpenses, netMargin, ...scenario }
}

export type Scenario = ReturnType<typeof scenarioData>
export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
