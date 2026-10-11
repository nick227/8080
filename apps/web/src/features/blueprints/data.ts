import type { BudgetCategoryKey, BudgetDirectionKey } from '@project/shared'

// Editorial source data for the Reader. This is deliberately not the external import schema.
export type Horizon = '30' | '90' | '365'
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
const person = (id: string, name: string, role: string, responsibility: string, hours: number, from = 30): Person => ({ id, name, role, responsibility, hours, from, initials: name.split(' ').map(n => n[0]).join('') })
const project = (id: string, title: string, description: string, outcome: string, from = 30): Project => ({ id, title, description, outcome, from })
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
    slug: 'solo-operator', type: 'Solo Operator', title: 'Solo Operator', subtitle: 'Plan the work you can deliver yourself.', image: 'solo-desk', accent: '#b77b46', specialization: 'General operating model',
    description: 'A single owner handles enquiries, delivery, and the weekly review. Start with one offer and a clear limit on concurrent work.',
    intro: 'The first constraint is time. This model keeps sales, delivery, and administration visible in one weekly plan. It suits independent service work without assuming a particular trade or profession.',
    principle: 'Keep a small queue. Finish the agreed work before adding another commitment.',
    tradeoff: 'One person owns every decision. Protect delivery time, and leave room for customer questions and revisions rather than planning every hour.',
    offer: 'One clearly scoped service, a written deliverable, and an agreed review point. The owner chooses the actual service and customer group.',
    acquisition: 'Prepare a clearly labeled example of the service, identify suitable potential customers yourself, and keep a record of enquiries. Review which requests fit the offer before accepting work.',
    people: [person('owner', 'Alex Morgan', 'Owner & operator', 'Qualify enquiries, agree scope, deliver the work, and review capacity.', 28), person('specialist', 'Robin Ellis', 'Occasional specialist', 'Review unfamiliar work or cover a clearly defined specialist task.', 4, 365)],
    projects: [project('offer', 'Define the offer', 'Decide what you will deliver and where the work ends.', 'A written service description.'), project('intake', 'Prepare customer intake', 'Make enquiries easy to assess before promising a date.', 'An enquiry form and scope checklist.'), project('delivery', 'Run a small delivery cycle', 'Use a sample brief to test the delivery process.', 'A reviewed sample deliverable.'), project('review', 'Establish a weekly review', 'Keep capacity, enquiries, and follow-up work visible.', 'A repeatable weekly routine.'), project('refine', 'Refine the service', 'Use observations from completed work to simplify the offer.', 'A revised service and capacity plan.', 90), project('resilience', 'Plan for interruptions', 'Document how work continues when the owner is unavailable.', 'A coverage and handover plan.', 365)],
    tasks: [
      ...projectTasks('offer',30,[['Write the service description','owner','List the deliverables, exclusions, and review steps.','One service page with explicit boundaries.',90],['Define a suitable customer','owner','Describe the need you can address and who approves the work.','A short customer-fit checklist.',60],['Set a work-in-progress limit','owner','Reserve time for enquiries and administration before committing delivery hours.','A maximum concurrent-work limit with written assumptions.',45]]),
      ...projectTasks('intake',30,[['Draft the enquiry questions','owner','Ask what is needed, by when, and who will make decisions.','A reusable enquiry form.',60],['Create a scope checklist','owner','Separate included work from optional requests and approval points.','A checklist used before agreeing to work.',75],['Test the intake process','owner','Use a fictional request and note any missing information.','One sample enquiry assessed without unanswered scope questions.',45]]),
      ...projectTasks('delivery',30,[['Plan a sample assignment','owner','Break one fictional brief into preparation, delivery, and review.','A task list with a realistic time allowance.',60],['Prepare a sample deliverable','owner','Produce a small example and label it as sample work.','A sample that demonstrates the promised output.',180],['Review the handover','owner','Check the files, instructions, and unresolved questions.','A handover checklist with a clear completion test.',60]]),
      ...projectTasks('review',30,[['Review the enquiry queue','owner','Check new requests and record the next action for each.','Every open enquiry has a next action.',30,0],['Review delivery capacity','owner','Compare current commitments with the time available next week.','An updated delivery plan within capacity.',30,3],['Write the weekly review','owner','Record what was delivered, what slipped, and one improvement.','A short review with an owner for the next change.',45,4]]),
      ...projectTasks('refine',90,[['Compare planned and actual effort','owner','Review the notes from completed work; distinguish sample assumptions from observed data.','A list of the largest estimation gaps.',90],['Revise the service boundaries','owner','Clarify requests that repeatedly required extra work.','An updated offer and intake checklist.',90],['Review follow-up opportunities','owner','Identify relevant next steps for your actual customers.','A reviewed follow-up list; no messages are sent automatically.',45]]),
      ...projectTasks('resilience',365,[['Document a handover procedure','owner','List the information another person would need for an agreed handover.','A procedure without private credentials embedded.',90],['Review specialist requirements','specialist','Identify work that needs skills or capacity beyond the owner.','A written scope for occasional support.',60],['Review the next operating year','owner','Revisit the offer, workload limit, and time away from work.','An annual operating review and revised capacity assumptions.',120]]),
    ],
    scenarios: {
      '30': {
        label: 'First 30 days',
        summary: 'Define one service and test the whole delivery process before taking on a large queue.',
        capacity: 'One owner · 28 hours/week',
        budget: [
          item('Initial client service retainer', 4500, 'Agreed retainer for the initial pilot engagement deliverable.', 'income', 'client_retainer', 'delivery-2'),
          item('Tools & delivery software', 80, 'Monthly subscription allowance for core project and client tools.', 'expense', 'software_tools', 'intake-1'),
          item('Intake assets & sample materials', 120, 'Templates, presentation assets, and intake documentation collateral.', 'expense', 'materials_cogs', 'delivery-2'),
          item('Specialist consultation reserve', 0, 'No outside specialist contracted during pilot setup.', 'expense', 'contractor_support'),
        ],
      },
      '90': {
        label: 'First 90 days',
        summary: 'Keep the same small operating model while refining scope and effort estimates.',
        capacity: 'One owner · 28 hours/week',
        budget: [
          item('Client service retainers', 14000, 'Projected retainer revenue across recurring client cycles.', 'income', 'client_retainer', 'delivery-2'),
          item('Advisory & scoping sessions', 2500, 'Intake consultation and service scoping reviews.', 'income', 'consulting', 'intake-2'),
          item('Tools & delivery software', 240, 'Three-month tool stack covering project tracking, documents, and communication.', 'expense', 'software_tools'),
          item('Collateral & delivery assets', 200, 'Client-facing templates, checklists, and delivery materials.', 'expense', 'materials_cogs'),
          item('Specialist review allowance', 250, 'Second-opinion review on complex client requirements.', 'expense', 'contractor_support', 'refine-2'),
        ],
      },
      '365': {
        label: 'One year',
        summary: 'Document the routine, allow occasional specialist support, and plan for time away.',
        capacity: 'One owner + occasional specialist',
        budget: [
          item('Annual client retainers', 62000, 'Steady recurring client engagements within solo 28h/week capacity.', 'income', 'client_retainer'),
          item('Fixed-scope project delivery', 18000, 'Specialized milestone projects delivered during the operating year.', 'income', 'project_fee'),
          item('Operational software & infrastructure', 960, 'Annual software stack, accounting tools, and communication platform.', 'expense', 'software_tools'),
          item('Client materials & production assets', 400, 'Handover materials, guides, and client documentation.', 'expense', 'materials_cogs'),
          item('Specialist coverage allowance', 2000, 'Robin Ellis specialist assistance covering unfamiliar work or scheduled leave.', 'expense', 'contractor_support', 'resilience-2'),
        ],
      },
    },
  },
  {
    slug: 'lean-service-team', type: 'Lean Service Team', title: 'Lean Service Team', subtitle: 'Separate intake, delivery, and quality checks.', image: 'interiors', accent: '#658371', specialization: 'Example: property care',
    description: 'A three-person service team shares a schedule, assigns each job, and checks the work before closing it.',
    intro: 'A small service team needs more than a shared to-do list. Someone must own the request, someone must own the visit, and someone must confirm that the promised work was completed. This example uses property care; the handoff model applies to other scheduled services.',
    principle: 'Every job has one owner, a written scope, and a completion check.',
    tradeoff: 'Travel, access problems, and rework reduce available delivery time. Keep a buffer in the schedule rather than treating every hour as bookable.',
    offer: 'A defined set of property-care services delivered in scheduled visits. The actual service area, equipment, and requirements must be chosen by the team.',
    acquisition: 'Build your own list of relevant property contacts. Record enquiries, assess the scope, and confirm access and timing before adding a visit to the schedule.',
    people: [person('coordinator','Sam Rivera','Service coordinator','Handle enquiries, prepare visit details, and maintain the schedule.',30),person('lead','Jo Bennett','Delivery lead','Own the visit plan, check equipment, and review completed work.',32),person('operator','Taylor Chen','Service operator','Complete the assigned work and record exceptions for review.',32),person('support','Casey Reed','Part-time support','Cover agreed visits and keep the materials list current.',16,90)],
    projects: [project('scope','Define the service area','Agree the work and locations the team can support.','A service and coverage guide.'),project('jobs','Build the job workflow','Make each request ready for the delivery team.','A job intake and dispatch checklist.'),project('pilot','Rehearse a service visit','Test preparation, delivery, and quality review.','A documented sample visit.'),project('routine','Coordinate the week','Make responsibilities and schedule changes visible.','A shared weekly planning rhythm.'),project('capacity','Add limited capacity','Introduce support only after the handoff process is documented.','A support plan and revised schedule.',90),project('standards','Review service standards','Compare patterns across work and revise the operating guide.','A reviewed annual service plan.',365)],
    tasks: [
      ...projectTasks('scope',30,[['List included services','lead','Describe each service and its exclusions.','A service list the coordinator can use.',90],['Map the service area','coordinator','Choose a realistic coverage area and note travel assumptions.','A written coverage policy.',60],['List equipment requirements','operator','Identify tools, supplies, and checks for each service.','An equipment checklist with gaps recorded.',90]]),
      ...projectTasks('jobs',30,[['Write the intake checklist','coordinator','Capture scope, access, timing, and the customer contact.','A complete job brief template.',60],['Define the job handoff','lead','Specify what must be confirmed before a visit is assigned.','A ready-for-dispatch checklist.',60],['Prepare the completion record','operator','Record the work done, exceptions, and follow-up needs.','A completion note template.',45]]),
      ...projectTasks('pilot',30,[['Plan a fictional service visit','coordinator','Schedule a sample visit with explicit travel and preparation time.','A sample visit plan with a named owner.',60],['Rehearse the work checklist','operator','Walk through the sample job and identify missing instructions.','A tested checklist and exception notes.',150],['Review the sample handoff','lead','Compare the brief with the completion note and discuss gaps.','An updated handoff standard.',60]]),
      ...projectTasks('routine',30,[['Plan the service week','coordinator','Review job scope, team availability, and travel buffers.','A schedule with a clear owner for each visit.',45,0],['Check materials and access','operator','Confirm supplies and access requirements for upcoming work.','A readiness list with unresolved issues flagged.',30,2],['Review completed visits','lead','Check completion notes and agree any follow-up work.','A list of follow-ups with owners.',45,4]]),
      ...projectTasks('capacity',90,[['Write the support-role brief','lead','Describe the work a part-time person can take on independently.','A role brief with handoff and review rules.',60],['Rehearse a support handoff','support','Use a sample job to test the documented process.','A reviewed support checklist.',90],['Recheck available capacity','coordinator','Keep the schedule within actual availability and buffers.','A revised weekly capacity plan.',60]]),
      ...projectTasks('standards',365,[['Review recurring exceptions','lead','Group observed problems and identify changes to the service guide.','An updated exception-handling guide.',120],['Review supply requirements','operator','Compare the inventory list with the work the team performs.','A reviewed materials and equipment plan.',90],['Plan seasonal availability','coordinator','Record expected time away and changes in operating availability.','An annual staffing and schedule outline.',120]]),
    ],
    scenarios: {
      '30': {
        label: 'First 30 days',
        summary: 'Establish a three-person handoff and rehearse a complete service visit.',
        capacity: 'Three people · shared visit schedule',
        budget: [
          item('Scheduled property service contracts', 9200, 'Initial property care service contracts and rehearsal visits.', 'income', 'project_fee', 'pilot-1'),
          item('Dispatch & coordination software', 120, 'Shared mobile schedule and dispatch platform.', 'expense', 'software_tools', 'jobs-1'),
          item('Service equipment & protective gear', 600, 'Field equipment, safety kits, and property care supplies.', 'expense', 'materials_cogs', 'scope-3'),
          item('External contractor allowance', 0, 'Initial visits managed entirely by core three-person team.', 'expense', 'contractor_support'),
        ],
      },
      '90': {
        label: 'First 90 days',
        summary: 'Add part-time support after the job brief and completion checks are consistent.',
        capacity: 'Three people + part-time support',
        budget: [
          item('Retained property care contracts', 28000, 'Recurring maintenance contracts across active properties in coverage zone.', 'income', 'client_retainer'),
          item('On-demand visit billings', 4000, 'Ad-hoc urgent property care and seasonal turnover visits.', 'income', 'project_fee'),
          item('Team dispatch & scheduling software', 360, 'Quarterly team dispatch, route planning, and completion records.', 'expense', 'software_tools'),
          item('Field materials & equipment maintenance', 900, 'Consumables, replacement supplies, and routine tool maintenance.', 'expense', 'materials_cogs'),
          item('Part-time coverage support', 1800, 'Casey Reed scheduled visit coverage during peak delivery windows.', 'expense', 'contractor_support', 'capacity-2'),
        ],
      },
      '365': {
        label: 'One year',
        summary: 'Review exceptions, seasonal availability, and the equipment needed for repeatable work.',
        capacity: 'Four roles · seasonal planning',
        budget: [
          item('Annual commercial & property accounts', 120000, 'Year-round scheduled maintenance agreements across residential and commercial sites.', 'income', 'client_retainer'),
          item('Seasonal specialty service projects', 25000, 'High-margin seasonal maintenance, restoration, and property preparation.', 'income', 'project_fee'),
          item('Operating software & dispatch stack', 1440, 'Annual coordination, client portal, and completion records software.', 'expense', 'software_tools'),
          item('Equipment, fleet & site consumables', 2400, 'Annual equipment upkeep, consumables, and safety gear replacement.', 'expense', 'materials_cogs', 'standards-2'),
          item('Flexible support & seasonal coverage', 7200, 'Part-time coverage for peak seasonal demand and operator leave.', 'expense', 'contractor_support'),
        ],
      },
    },
  },
  {
    slug: 'project-studio', type: 'Project Studio', title: 'Project Studio', subtitle: 'A small studio organized around delivery.', image: 'studio', accent: '#758aa7', specialization: 'Example: design studio',
    description: 'A studio manages briefs, reviews, production, and handover across a small number of concurrent projects.',
    intro: 'Project work becomes difficult when decisions arrive late or ownership is unclear. This studio sets an approval point at each stage, protects production time, and keeps customer feedback attached to the work it concerns.',
    principle: 'Agree what is being reviewed, who decides, and what happens after approval.',
    tradeoff: 'More concurrent projects create more review and coordination work. Set a studio-wide limit and leave time for customer feedback rather than filling every production slot.',
    offer: 'Scoped design projects with a written brief, staged reviews, and a defined handover. The operating model can also be used for development, research, or other project-based work.',
    acquisition: 'Use examples of your own work to explain the offer. Qualify enquiries against the studio’s skills and capacity, then prepare a proposal for a clearly defined project.',
    people: [person('producer','Morgan Lee','Producer','Qualify enquiries, agree scope, and keep decisions and milestones current.',30),person('creative','Avery Stone','Design lead','Translate the brief into a direction and review the quality of the work.',32),person('maker','Jamie Park','Designer','Prepare concepts, production files, and handover materials.',32),person('specialist','Drew Quinn','Production specialist','Take on scoped production work and document delivery details.',20,90),person('account','Riley Brooks','Client coordinator','Manage review scheduling and gather consolidated feedback.',24,365)],
    projects: [project('position','Define the studio offer','Set the scope and concurrency limit before filling the pipeline.','A studio service and capacity plan.'),project('brief','Prepare a project brief','Make goals, deliverables, and approvals explicit.','A brief and review schedule.'),project('produce','Run a sample project','Move one fictional project through concept, review, and handover.','A complete sample delivery.'),project('cadence','Run the studio week','Keep production and decisions moving together.','A weekly delivery rhythm.'),project('portfolio','Refine the project system','Use experience to improve reviews and add specialist capacity.','A revised studio delivery guide.',90),project('year','Plan a year of project work','Review the portfolio and the roles needed to support it.','An annual capacity and improvement plan.',365)],
    tasks: [
      ...projectTasks('position',30,[['Write the studio service list','creative','Define the outputs the studio can produce and the work it excludes.','A service list with clear scope boundaries.',90],['Set the concurrent-project limit','producer','Reserve time for reviews and coordination as well as production.','A written limit based on available people.',60],['Create an enquiry checklist','producer','Capture goals, deadlines, decision-makers, and fit.','A brief qualification checklist.',60]]),
      ...projectTasks('brief',30,[['Draft the project brief','creative','Describe the audience, problem, deliverables, and constraints.','A brief with unanswered questions identified.',90],['Define review checkpoints','producer','Name the decisions required at each review and who makes them.','A review plan with approval criteria.',60],['Prepare the production checklist','maker','List the files, formats, and checks needed at handover.','A delivery checklist tied to the brief.',60]]),
      ...projectTasks('produce',30,[['Develop a sample concept','maker','Use a fictional brief and label the resulting work as a sample.','A concept ready for a direction review.',180],['Review the concept against the brief','creative','Separate required changes from optional suggestions.','A recorded direction decision and change list.',60],['Prepare the sample handover','maker','Package the final files and usage notes.','A handover that passes the delivery checklist.',120]]),
      ...projectTasks('cadence',30,[['Review the studio project board','producer','Check project owners, current stages, and decisions needed this week.','Every active project has a next action.',45,0],['Hold a production review','creative','Review work in progress against the agreed brief.','A short action list with owners.',60,2],['Review upcoming approvals','producer','Confirm which decisions are needed before the next stage.','A review schedule with outstanding decisions visible.',30,4]]),
      ...projectTasks('portfolio',90,[['Document the specialist handoff','specialist','Specify inputs, output formats, and quality checks.','A reusable production handoff.',90],['Review project effort','producer','Compare estimates with observed effort and note review overhead.','A capacity plan using the team’s own observations.',90],['Update the project guide','creative','Revise briefing and review instructions from completed work.','A revised delivery guide.',90]]),
      ...projectTasks('year',365,[['Review the project mix','producer','Compare the types of work with available skills and capacity.','An annual project-capacity review.',120],['Define client-coordination ownership','account','Document how review times and consolidated feedback are handled.','A client coordination procedure.',90],['Plan the next development priorities','creative','Choose improvements to skills, tools, and production practices.','A prioritized studio improvement plan.',120]]),
    ],
    scenarios: {
      '30': {
        label: 'First 30 days',
        summary: 'Three people establish the studio process and complete a fictional sample project.',
        capacity: 'Three people · one sample project',
        budget: [
          item('Pilot project milestone fee', 18000, 'Initial discovery and concept milestone for pilot studio project.', 'income', 'project_fee', 'produce-1'),
          item('Studio collaboration & design licenses', 180, 'Monthly creative tools, asset libraries, and project boards.', 'expense', 'software_tools', 'position-2'),
          item('Prototyping & sample materials', 200, 'Presentation decks, proofs, and sample deliverable assets.', 'expense', 'materials_cogs', 'produce-3'),
          item('External specialist allowance', 0, 'Pilot project delivered fully in-house.', 'expense', 'contractor_support'),
        ],
      },
      '90': {
        label: 'First 90 days',
        summary: 'Introduce a production specialist and refine briefing, reviews, and handover.',
        capacity: 'Four people · limited concurrency',
        budget: [
          item('Client project milestone billings', 48000, 'Two concurrent client design projects through discovery, review, and handover.', 'income', 'project_fee', 'produce-2'),
          item('Design advisory retainers', 10000, 'Ongoing creative direction and brand guideline advisory accounts.', 'income', 'client_retainer'),
          item('Design & review platform licenses', 540, 'Quarterly licenses for design prototyping, staging, and client reviews.', 'expense', 'software_tools'),
          item('Mockup & presentation materials', 400, 'Physical and digital prototype mockups for milestone reviews.', 'expense', 'materials_cogs'),
          item('Specialist production support', 2400, 'Drew Quinn specialist production assistance on complex asset deliverables.', 'expense', 'contractor_support', 'portfolio-1'),
        ],
      },
      '365': {
        label: 'One year',
        summary: 'Add dedicated client coordination and review the mix of projects the studio can support.',
        capacity: 'Five roles · annual capacity plan',
        budget: [
          item('Annual project engagements', 210000, 'Planned pipeline of scoped multi-phase studio client projects.', 'income', 'project_fee', 'produce-3'),
          item('Strategic creative partner retainers', 50000, 'Annual retainer partnerships with scheduled review checkpoints.', 'income', 'client_retainer'),
          item('Creative software & studio infrastructure', 2160, 'Annual studio software stack, rendering services, and font/asset subscriptions.', 'expense', 'software_tools'),
          item('Production proofs & presentation collateral', 1000, 'Sample deliverable packaging, print proofs, and client archives.', 'expense', 'materials_cogs'),
          item('Specialist freelancers & production support', 9600, 'Specialist contractors and external craft support for peak production waves.', 'expense', 'contractor_support'),
        ],
      },
    },
  },
]
export const horizons: Horizon[] = ['30','90','365']
export function scenarioData(bp: Blueprint, horizon: Horizon) {
  const days = Number(horizon)
  const projects = bp.projects.filter(p => p.from <= days)
  const people = bp.people.filter(p => p.from <= days)
  const tasks = bp.tasks.filter(t => t.from <= days).map(t => {
    const index = projects.findIndex(p => p.id === t.project)
    const local = bp.tasks.filter(x => x.project === t.project).findIndex(x => x.id === t.id)
    // Launch work remains early. Later scenarios add operating-review projects.
    const projectStart = index < 4 ? [0,5,12,19][index] : index === 4 ? 55 : 290
    return { ...t, day: projectStart + local * 2 }
  })
  const milestones = projects.map(p => ({ id: `milestone-${p.id}`, project: p.id, title: p.outcome, day: Math.max(...tasks.filter(t => t.project === p.id).map(t => t.day)) + 2 }))
  const scenario = bp.scenarios[horizon]
  const totalIncome = scenario.budget.filter(b => b.direction === 'income').reduce((s, b) => s + b.amount, 0)
  const totalExpenses = scenario.budget.filter(b => b.direction === 'expense').reduce((s, b) => s + b.amount, 0)
  const netMargin = totalIncome - totalExpenses
  return { days, projects, people, tasks, milestones, totalIncome, totalExpenses, netMargin, ...scenario }
}
export type Scenario = ReturnType<typeof scenarioData>
export const money = (n: number) => new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD', maximumFractionDigits:0 }).format(n)
