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
  /** Plain-language page copy: one-sentence summary and three "how it works" points. */
  brief: { summary: string; how: [string, string, string] };
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
    subtitle: 'A structured 90-day plan for an independent consultant working with a part-time bookkeeper.',
    image: 'solo-desk',
    accent: '#b77b46',
    specialization: 'Independent consulting & advisory services',
    description: 'A solo consultant balances client work, sales, invoicing, and weekly admin with support from a part-time bookkeeper.',
    brief: {
      summary: 'One consultant runs an advisory practice with a part-time bookkeeper: two clients at a time, about 38 hours a week.',
      how: [
        'Monday to Thursday is client work. Friday morning is invoices, books, and follow-ups.',
        'Every client starts with a paid discovery session, then a fixed-price project or monthly retainer.',
        'About 10 hours a week stay set aside for finding the next clients.',
      ],
    },
    intro: 'Solo consultants often get caught in a feast-or-famine cycle—spending weeks buried in client work, then scrambling for new business when projects end. This 90-day starter plan sets a steady weekly rhythm: client work Monday through Thursday, billing and admin on Friday morning, and protected time each week to nurture new work.',
    principle: 'Work on client projects four days a week, and keep Friday mornings for invoicing, bookkeeping, and pipeline follow-ups. Charge by milestones or monthly retainers instead of hourly rates, so you can serve two clients at once without burning out.',
    offer: 'Offer two clear services: fixed-price advisory projects and monthly retainers. Every client relationship starts with a paid discovery phase to set goals and boundaries before any long-term commitment.',
    tradeoff: 'You cannot work more hours without burning out, so grow revenue by taking on higher-value projects rather than more clients. Keep 10 hours each week reserved for business development and admin, so finding new clients never gets squeezed out by current work.',
    acquisition: 'Win clients through warm introductions, direct outreach to industry leaders, and regular check-ins with past clients. Screen incoming leads with a simple checklist before booking meetings to avoid unpaid work and endless proposals.',
    people: [
      person('owner', 'Alex Morgan', 'Lead Consultant & Practice Owner', 'Handles consulting work, speaks with prospective clients, and directs business strategy.', 32),
      person('finance', 'Jordan Vance', 'Bookkeeper & Administrative Specialist', 'Balances the books weekly, sends invoices, tracks overdue payments, and helps with tax filings.', 6),
    ],
    projects: [
      project('position', 'Pricing & Client Terms', 'Create client agreements, a clear rate card, and a simple checklist for client fit.', 'A signed service agreement template and clear pricing schedule.'),
      project('intake', 'Client Intake & Discovery', 'Set up a smooth process to screen leads, run discovery calls, and onboard clients.', 'A standardized client screening checklist and onboarding guide.'),
      project('delivery', 'Client Work & Milestones', 'Deliver client work with regular updates, clear milestones, and formal sign-offs.', 'Completed client deliverables with signed milestone approvals.'),
      project('billing', 'Weekly Invoicing & Cashflow', 'Run a steady weekly routine for invoicing, expense tracking, and bookkeeping.', 'Up-to-date accounting records and a 30-day cashflow forecast.'),
      project('pipeline', 'Pipeline & Past Clients', 'Stay in touch with past clients, gather testimonials, and reach out to new leads.', 'An active prospect pipeline and client case study library.'),
    ],
    tasks: [
      ...projectTasks('position', 90, [
        ['Standardize client agreement and scope terms', 'owner', 'Draft contract terms covering intellectual property, payment milestones, and out-of-scope requests.', 'A standard client agreement template with clear boundaries and payment terms.', 90],
        ['Establish engagement pricing and retainer tiers', 'owner', 'Define fixed-fee project milestone rates and recurring monthly advisory tiers.', 'A clear pricing sheet with project rates and monthly retainer options.', 60],
        ['Define ideal client qualification criteria', 'owner', 'Outline the budget, company size, and project types that make for a great client fit.', 'A one-page client fit checklist for screening incoming leads.', 45],
      ]),
      ...projectTasks('intake', 90, [
        ['Build incoming lead screening form', 'owner', 'Create a quick checklist to review project scope, timing, and budget before taking a call.', 'A screening form to evaluate incoming inquiries.', 60],
        ['Prepare client discovery session agenda', 'owner', 'Structure a two-hour discovery session agenda to understand client goals, challenges, and timelines.', 'A reusable discovery agenda and notes template.', 75],
        ['Create formal proposal and scope template', 'owner', 'Set up a clear proposal layout with project goals, deliverables, timeline, and pricing.', 'A reusable proposal template ready to customize for clients.', 90],
        ['Create client onboarding checklist', 'owner', 'List the accounts, logins, contacts, and files needed before kicking off client work.', 'A checklist to get clients set up without missing anything.', 45],
      ]),
      ...projectTasks('delivery', 90, [
        ['Send weekly client progress update', 'owner', 'Write a short update covering what got done this week, what is up next, and any decisions needed.', 'A clear weekly status note sent to the client.', 45, 0],
        ['Draft primary project deliverable', 'owner', 'Complete research, analysis, and recommendations outlined in the agreed statement of work.', 'A complete first draft ready for client review.', 180],
        ['Review draft deliverable with client', 'owner', 'Walk through the findings with the client and capture their feedback and questions.', 'Notes from the review meeting with agreed-upon edits.', 60],
        ['Deliver final files and get sign-off', 'owner', 'Make final edits, package files, and get written approval from the client.', 'Final files delivered and signed off by the client.', 90],
      ]),
      ...projectTasks('billing', 90, [
        ['Send deposit and milestone invoices', 'finance', 'Send invoices when contracts are signed and when project milestones are finished.', 'Invoices sent and logged in the accounting system.', 45],
        ['Review weekly hours and expenses', 'owner', 'Check hours logged on client projects and record receipts for software and travel.', 'An approved weekly log of time and business expenses.', 30, 4],
        ['Match bank deposits and follow up on overdue bills', 'finance', 'Match bank payments to open invoices, and send friendly reminders for unpaid bills past 15 days.', 'Up-to-date bookkeeping records with no unexplained balances.', 45, 4],
        ['Review monthly profit and loss', 'finance', 'Review total income, software and tool costs, and net profit against quarterly targets.', 'A monthly financial summary reviewed by the business owner.', 60],
      ]),
      ...projectTasks('pipeline', 90, [
        ['Reach out to 10 prospective clients', 'owner', 'Send personalized notes with helpful insights to 10 target companies.', 'Notes logged from outreach calls and conversations.', 60, 2],
        ['Ask completed clients for feedback and referrals', 'owner', 'Check in with past clients to hear what went well, what could improve, and ask for a testimonial.', 'Written client feedback and an authorized testimonial quote.', 45],
        ['Write a short project case study', 'owner', 'Write a brief story showing the client\'s challenge, what you built or solved, and the results.', 'A published case study to share with prospective clients.', 90],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Run an independent consulting practice with two active clients, weekly bookkeeping, and a steady 38-hour routine.',
        capacity: 'Alex Morgan (32h/wk) · Jordan Vance (6h/wk)',
        budget: [
          item('Strategic client retainers', 18000, 'Three client retainers at $6,000 per quarter.', 'income', 'client_retainer', 'delivery-1'),
          item('Fixed-scope project engagements', 12000, 'Two fixed-price consulting projects completed during the quarter.', 'income', 'project_fee', 'delivery-2'),
          item('Paid discovery sessions', 3000, 'Initial paid discovery sessions with prospective clients.', 'income', 'consulting', 'intake-2'),
          item('Practice software & cloud tools', 360, 'Subscriptions for CRM, proposals, file storage, and video calls.', 'expense', 'software_tools', 'position-1'),
          item('Client presentation collateral & assets', 250, 'Templates, report designs, and workshop materials.', 'expense', 'materials_cogs', 'intake-3'),
          item('Bookkeeping & compliance support', 1200, 'Weekly bookkeeping and accounts reconciliation by Jordan Vance.', 'expense', 'contractor_support', 'billing-3'),
        ],
      },
    },
  },
  {
    slug: 'lean-service-team',
    type: 'Lean Service Team',
    title: 'Lean Service Team',
    subtitle: 'A 90-day plan for a four-person commercial property maintenance and field service team.',
    image: 'interiors',
    accent: '#658371',
    specialization: 'Commercial facilities & property maintenance',
    description: 'A four-person team coordinates daily dispatch, on-site service work, photo quality checks, prompt customer billing, and tools maintenance.',
    brief: {
      summary: 'Four people maintain commercial buildings on recurring contracts: a dispatcher, a field lead, a technician and a part-time office manager.',
      how: [
        'The office confirms site access 48 hours before each visit, and routes keep 25% spare time for delays.',
        'Technicians follow a written checklist, photograph the work, and get the customer\'s sign-off on site.',
        'Every finished job is invoiced within 24 hours.',
      ],
    },
    intro: 'Field service teams run into trouble when technicians arrive without building access, routes get packed too tightly, or billing falls weeks behind the work. This 90-day starter plan divides responsibilities cleanly: the office arranges access and schedules routes with travel buffers, technicians do the work and take photo proof, and completed jobs are invoiced within 24 hours.',
    principle: 'Every job follows three clear steps: the office confirms access codes and job details 48 hours in advance; technicians complete the site checklist and take photos of finished work; and the office sends the invoice within 24 hours of completion.',
    offer: 'The team provides recurring building maintenance, seasonal property turnarounds, and scheduled equipment checks. Each contract spells out the visit schedule, arrival windows, included parts, and digital inspection reports sent right to property managers.',
    tradeoff: 'Travel times, traffic, and access delays make it impossible to book technicians back-to-back without delays snowballing. The dispatcher keeps 25% buffer time in every daily route, keeping visits on time and preventing technicians from rushing.',
    acquisition: 'New clients come from property managers, medical offices, and retail centers. The team signs recurring contracts by offering initial property audits that uncover overlooked repairs and set a predictable maintenance budget.',
    people: [
      person('coordinator', 'Sam Rivera', 'Operations & Dispatch Coordinator', 'Takes in work orders, builds daily technician routes with travel buffers, and verifies site access codes.', 36),
      person('lead', 'Jo Bennett', 'Field Operations Lead', 'Supervises on-site jobs, enforces safety guidelines, conducts random quality checks, and trains technicians.', 38),
      person('technician', 'Taylor Chen', 'Senior Service Technician', 'Carries out scheduled property maintenance, takes photo logs of completed work, and tracks used parts.', 38),
      person('admin', 'Morgan Diaz', 'Office Manager & Finance Admin', 'Sends customer invoices within 24 hours, logs vendor receipts, orders supplies, and tracks unpaid bills.', 20),
    ],
    projects: [
      project('operations', 'Service Zones & Safety Standards', 'Set up geographic service areas, standard checklists, and safety guidelines.', 'A field operations guide and service catalog.'),
      project('dispatch', 'Dispatch & Site Access System', 'Set up a routine to collect gate codes, schedule routes with buffers, and dispatch jobs.', 'A weekly route schedule and building access directory.'),
      project('field', 'Field Work & Quality Checks', 'Carry out service visits with photo proof and customer sign-off.', 'Signed work orders with photo proof of completed work.'),
      project('billing', 'Daily Invoicing & Bookkeeping', 'Send invoices within 24 hours of job completion, match supplier receipts, and track payments.', 'Up-to-date invoicing records and 30-day cashflow summary.'),
      project('fleet', 'Vehicles, Tools & Supplies', 'Keep service vans running safely, maintain tools, and restock common replacement parts.', 'A parts inventory log and vehicle maintenance inspection sheet.'),
    ],
    tasks: [
      ...projectTasks('operations', 90, [
        ['Set up service zones and travel buffers', 'coordinator', 'Divide the service region into clusters and set realistic travel times between stops.', 'A territory map with realistic travel times between stops.', 60],
        ['Write standard checklists for core services', 'lead', 'Document step-by-step tasks, required tools, and completion criteria for common maintenance visits.', 'A clear field checklist manual for technicians.', 90],
        ['Create pre-job safety checklist', 'lead', 'Build a quick pre-work safety check for power cutoffs, protective gear, and ladders.', 'A required safety checklist filled out before starting each job.', 60],
      ]),
      ...projectTasks('dispatch', 90, [
        ['Create work-order and access template', 'coordinator', 'Design a form to collect gate codes, building manager contacts, and special site instructions.', 'A work-order template ready for technician dispatch.', 60],
        ['Set up weekly route schedule', 'coordinator', 'Group visits by neighborhood and build in 25% buffer time for traffic and unexpected delays.', 'A balanced weekly schedule with primary and backup technician assignments.', 45, 0],
        ['Confirm gate codes 48 hours before visits', 'coordinator', 'Call or message property managers two days ahead to confirm gate codes, parking, and building keys.', 'Confirmed access notes logged in the work order before the technician leaves.', 30, 2],
      ]),
      ...projectTasks('field', 90, [
        ['Complete scheduled maintenance visit', 'technician', 'Perform the required maintenance checklist on site, test equipment, and check safety shutoffs.', 'Completed checklist with equipment readings and notes.', 150],
        ['Take before-and-after photos and note repairs', 'technician', 'Photograph finished work and document any worn parts or repairs that need a quote.', 'Timestamped photos and repair notes saved to the job file.', 30],
        ['Conduct random quality check on site', 'lead', 'Visit 10% of completed jobs unannounced to inspect workmanship and safety adherence.', 'A quality score and feedback logged for the technician.', 60, 3],
        ['Get customer sign-off on site', 'technician', 'Walk through completed tasks with the on-site building manager and capture their signature.', 'A signed work-order note confirming the work is done.', 30],
      ]),
      ...projectTasks('billing', 90, [
        ['Send customer invoices within 24 hours', 'admin', 'Review finished work orders, add parts used, and email invoices to property managers within 24 hours.', 'Invoices emailed with photo proof attached.', 60, 4],
        ['Match supplier receipts and trade contractor bills', 'admin', 'Match hardware receipts and subcontractor invoices to the correct customer jobs.', 'Accurate job cost records with all parts and contractor hours accounted for.', 60],
        ['Check unpaid bills and send payment reminders', 'admin', 'Review unpaid customer accounts each week and send friendly reminders for bills over 15 days.', 'An updated accounts report with zero bills past 45 days.', 45, 4],
        ['Review monthly profit by property', 'admin', 'Compare technician hours and parts used against monthly contract fees for each property.', 'A monthly report showing which client contracts are most profitable.', 75],
      ]),
      ...projectTasks('fleet', 90, [
        ['Check replacement parts stock and reorder', 'admin', 'Count air filters, hardware, lubricants, and safety gear, and order restocks when bins get low.', 'Purchase orders placed to keep parts in stock.', 45, 1],
        ['Inspect service vans and safety gear weekly', 'lead', 'Check van tire pressure, oil levels, ladder racks, first-aid kits, and safety gear every Monday.', 'A completed weekly vehicle safety checklist.', 45, 4],
        ['Meet with property managers for quarterly review', 'coordinator', 'Review completed visits with building owners, address any concerns, and renew ongoing contracts.', 'Meeting notes and signed contract renewals.', 60],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Four-person service team managing 8 commercial building contracts, daily route dispatch, and 24-hour invoicing.',
        capacity: 'Four roles · 132 combined hours/week',
        budget: [
          item('Commercial property maintenance agreements', 48000, 'Quarterly maintenance contracts across 8 commercial properties.', 'income', 'client_retainer', 'field-1'),
          item('Specialty repair & turnover work orders', 16000, 'On-demand service calls and seasonal property preparation.', 'income', 'project_fee', 'field-2'),
          item('Facility condition assessments & audits', 3500, 'Paid initial building inspections for prospective clients.', 'income', 'consulting', 'operations-1'),
          item('Field consumables & equipment upkeep', 2400, 'Filters, replacement hardware, safety supplies, and tool servicing.', 'expense', 'materials_cogs', 'fleet-1'),
          item('Dispatch, routing & mobile software', 540, 'Mobile work-order app, dispatch routing software, and GPS tracking.', 'expense', 'software_tools', 'dispatch-2'),
          item('Licensed trade contractor reserve', 3200, 'Subcontracted help for specialized electrical and HVAC repairs.', 'expense', 'contractor_support', 'billing-2'),
          item('Service fleet fuel & operational costs', 2800, 'Gas, parking permits, and regular maintenance for service vans.', 'expense', 'travel_hospitality', 'fleet-2'),
          item('Office admin, billing & accounting tools', 360, 'Invoicing software, card processing fees, and bookkeeping software.', 'expense', 'legal_admin', 'billing-1'),
        ],
      },
    },
  },
  {
    slug: 'project-studio',
    type: 'Project Studio',
    title: 'Project Studio',
    subtitle: 'A 90-day plan for a five-person digital product design and development studio.',
    image: 'studio',
    accent: '#758aa7',
    specialization: 'Digital product design & web development',
    description: 'A five-person studio manages two client projects at a time in two-week sprints, with clear scopes and demo checkpoints.',
    brief: {
      summary: 'Five people run a design studio with two client projects at a time, in two-week sprints.',
      how: [
        'Each sprint starts with written acceptance criteria and ends with a client demo.',
        'One client sponsor sends combined feedback within three business days.',
        'Nobody works on more than two projects. New clients wait for a free slot.',
      ],
    },
    intro: 'Design and tech studios lose money and burn out when project scopes expand without extra budget, feedback rounds drag on forever, or teams take on too many projects at once. This 90-day starter plan keeps studio work calm and profitable: two projects at a time, two-week sprints with clear acceptance criteria, and one client sponsor who provides combined feedback within three days.',
    principle: 'Run two client projects at a time in two-week sprints. Every sprint starts with written goals and clear acceptance criteria, includes a mid-sprint review, and wraps up with a live demo. One client point-of-contact gathers and combines feedback within three business days, so the team never gets caught between conflicting requests.',
    offer: 'The studio designs digital products, builds design systems, and codes interactive web prototypes. Every project has a written scope with clear limits on revisions, asset handoffs, and follow-up support, rather than open-ended hourly billing.',
    tradeoff: 'Designers and engineers do worse work when juggling too many clients at once. The studio limits everyone to a maximum of two active projects. New clients reserve a start date on the calendar instead of cramming into active sprints.',
    acquisition: 'New work comes from portfolio case studies, partner referrals, and conversations with tech and product leaders. Proposals are only written after a paid discovery workshop, ensuring project timelines and budgets are grounded in realistic requirements.',
    people: [
      person('producer', 'Morgan Lee', 'Executive Producer & Account Director', 'Manages client relationships, plans sprint timelines, guides contracts, and tracks project budgets.', 34),
      person('director', 'Avery Stone', 'Design Director', 'Sets design direction, leads critique sessions, reviews design system components, and presents to clients.', 36),
      person('maker', 'Jamie Park', 'Senior Designer & Systems Maker', 'Designs UI component libraries, builds Figma design systems, and prepares files for developer handoff.', 36),
      person('engineer', 'Drew Quinn', 'Technical Implementation Specialist', 'Builds interactive front-end prototypes, audits technical feasibility, and checks API integrations.', 28),
      person('finance', 'Elena Rostova', 'Studio Operations & Finance Manager', 'Sends milestone invoices, tracks monthly expenses, pays contractors, and reviews project profit margins.', 14),
    ],
    projects: [
      project('commercial', 'Client Contracts & Scope Rules', 'Set up client agreement templates, project scopes, and rules for extra revisions.', 'Standard client agreement template and clear project rate card.'),
      project('discovery', 'Discovery & Project Requirements', 'Run a paid technical discovery session and outline clear acceptance criteria.', 'A project charter, technical spec, and milestone roadmap.'),
      project('sprints', 'Two-Week Sprints & Demos', 'Run two-week sprints with mid-point check-ins and live client demonstrations.', 'Approved UI components, design systems, and clickable prototypes.'),
      project('handover', 'QA & Developer Handoff', 'Package design files, run accessibility checks, and get final client sign-off.', 'Complete design asset package and signed project completion notice.'),
      project('finance', 'Milestone Invoicing & New Leads', 'Send milestone invoices, track project profits, and follow up with prospective clients.', 'Monthly profit reports and an active pipeline of future projects.'),
    ],
    tasks: [
      ...projectTasks('commercial', 90, [
        ['Standardize client agreement and scope templates', 'producer', 'Draft contract terms covering intellectual property transfer, milestone billing, and change orders.', 'A standard client agreement template and scope of work outline.', 90],
        ['Set client revision limits and extra rates', 'producer', 'State how many revision rounds are included in each milestone and set hourly rates for new requests.', 'A clear scope and revisions policy included in every proposal.', 60],
        ['Build project pricing and margin calculator', 'finance', 'Model team hours, software overhead, and minimum profit targets for new projects.', 'A pricing calculator used to quote all new client projects.', 60],
      ]),
      ...projectTasks('discovery', 90, [
        ['Run full-day discovery and tech workshop', 'producer', 'Run a structured workshop with the client to define user flows, technical constraints, and key goals.', 'A workshop summary outlining project requirements and technical limits.', 120],
        ['Write project charter and acceptance criteria', 'director', 'Write clear acceptance criteria for every sprint milestone, defining exactly what "done" means.', 'A signed project charter with objective checklist criteria for each milestone.', 90],
        ['Check technical feasibility and third-party APIs', 'engineer', 'Review third-party APIs, database requirements, and browser performance before kickoff.', 'A technical summary highlighting potential risks before design starts.', 75],
      ]),
      ...projectTasks('sprints', 90, [
        ['Hold weekly studio sprint review', 'producer', 'Check sprint progress, clear team roadblocks, and review upcoming deadlines across both projects.', 'An updated sprint board with confirmed team assignments.', 45, 0],
        ['Build design system component library in Figma', 'maker', 'Design typography styles, color tokens, and responsive UI components with accessibility checks.', 'A published design system library ready for prototype use.', 180],
        ['Build interactive front-end prototype', 'engineer', 'Develop a working web prototype demonstrating user flows, state changes, and responsive layouts.', 'A working web prototype deployed to a private staging link.', 150],
        ['Demo sprint work to client stakeholders', 'director', 'Present finished sprint work to client stakeholders and review against agreed acceptance criteria.', 'A recorded demo session with written feedback notes.', 60, 3],
        ['Consolidate client feedback into sprint backlog', 'producer', 'Review client feedback against the scope, schedule approved tweaks, and save new ideas for later.', 'A prioritized feedback list agreed upon with the client sponsor.', 45, 4],
      ]),
      ...projectTasks('handover', 90, [
        ['Run accessibility and mobile screen checks', 'engineer', 'Test components against WCAG AA standards and verify layouts across mobile, tablet, and desktop.', 'An accessibility and responsiveness check report.', 60],
        ['Package production files and developer notes', 'maker', 'Export icons, SVGs, and tokens, and write clear developer handoff notes in Figma.', 'A complete asset package and documentation ready for client developers.', 120],
        ['Complete final walkthrough and secure sign-off', 'producer', 'Walk through the final delivery package with the client sponsor and get written approval.', 'Written client sign-off confirming the project milestone is accepted.', 45],
      ]),
      ...projectTasks('finance', 90, [
        ['Send milestone invoice upon client sign-off', 'finance', 'Create and email the milestone invoice as soon as the client signs off on deliverables.', 'An invoice sent and logged in the accounting system.', 45],
        ['Review specialist contractor bills and expenses', 'finance', 'Review contractor invoices against project budgets and approve payments.', 'An up-to-date project expense report with contractor receipts attached.', 45, 4],
        ['Review monthly studio profits and spending', 'finance', 'Check profit margins on each client project against the studio\'s 65% target margin.', 'A monthly financial summary presented to studio leadership.', 60],
        ['Share portfolio presentations with prospective clients', 'producer', 'Present recent case studies and studio capabilities to product and design leaders.', 'Introductory meetings scheduled with qualified prospective clients.', 75],
      ]),
    ],
    scenarios: {
      '90': {
        label: '90-Day Starter',
        summary: 'Five-person digital product studio delivering two client projects at a time with clear scopes and 65%+ gross margin.',
        capacity: 'Five roles · 148 combined hours/week',
        budget: [
          item('Milestone digital product contracts', 72000, 'Two comprehensive product design and system contracts at $36,000 each.', 'income', 'project_fee', 'sprints-2'),
          item('Strategic design advisory retainers', 18000, 'Two quarterly design advisory retainers at $9,000 each.', 'income', 'client_retainer', 'commercial-1'),
          item('Paid technical discovery workshops', 6000, 'Two upfront scoping and specification workshops preceding major builds.', 'income', 'consulting', 'discovery-1'),
          item('Creative software licenses & cloud tools', 1440, 'Subscriptions for Figma, GitHub, cloud hosting, and project tools.', 'expense', 'software_tools', 'commercial-1'),
          item('Interactive prototype staging & assets', 600, 'Staging servers, font licenses, and presentation materials.', 'expense', 'materials_cogs', 'sprints-3'),
          item('Specialist contractor & sound engineering', 5400, 'Specialist contract help for custom animations and technical audits.', 'expense', 'contractor_support', 'handover-1'),
          item('Legal, contract governance & accounting', 900, 'Contract legal reviews, business insurance, and quarterly accounting filings.', 'expense', 'legal_admin', 'finance-1'),
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
