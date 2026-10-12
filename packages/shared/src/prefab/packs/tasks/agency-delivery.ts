import type { PrefabPack, PrefabTask } from '../../schemas'

export const agencyDeliveryTasksPack: PrefabPack<PrefabTask> = {
  id: 'pack.tasks.agency-delivery',
  domain: 'tasks',
  name: 'Client Sprint Delivery Tasks',
  description: 'Production sprint engineering, design review, and milestone delivery tasks.',
  records: [
    {
      key: 'task:sprint-demo-prep',
      packId: 'pack.tasks.agency-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:lead-engineer'],
        documents: ['doc:sow-template'],
      },
      title: 'Prepare staging environment and run milestone demo checklist',
      category: 'delivery',
      roleKey: 'role:lead-engineer',
      documentKey: 'doc:sow-template',
      minutes: 90,
      priority: 'high',
      detail: 'Deploy sprint release build to client staging instance, verify seed data integrity, and run through the end-to-end user acceptance script before the client walk-through.',
      outcome: 'A verified staging deployment with zero critical console errors, seeded test records, and a drafted milestone acceptance note ready for client review.',
    },
    {
      key: 'task:design-token-audit',
      packId: 'pack.tasks.agency-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:senior-designer'],
      },
      title: 'Audit component accessibility and design token synchronization',
      category: 'delivery',
      roleKey: 'role:senior-designer',
      minutes: 60,
      priority: 'normal',
      detail: 'Review Figma component updates against CSS token definitions. Verify color contrast meets WCAG 2.2 AA standards and responsive break points behave as intended.',
      outcome: 'An updated design system changelog with verified contrast ratios and synchronized CSS variable tokens.',
    },
    {
      key: 'task:weekly-client-async-brief',
      packId: 'pack.tasks.agency-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:account-lead'],
        documents: ['doc:weekly-operating-cadence'],
      },
      title: 'Publish mid-week client progress briefing and dependency tracker',
      category: 'delivery',
      roleKey: 'role:account-lead',
      documentKey: 'doc:weekly-operating-cadence',
      repeat: 2, // Wednesday
      minutes: 45,
      priority: 'normal',
      detail: 'Summarize completed sprint tickets, preview upcoming milestone deliverables, and explicitly highlight any outstanding client decisions or asset approvals.',
      outcome: 'Client-facing status note delivered to shared channel with updated blocker log and milestone countdown.',
    },
    {
      key: 'task:milestone-handover-package',
      packId: 'pack.tasks.agency-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:account-lead', 'role:lead-engineer'],
        documents: ['doc:sow-template'],
      },
      title: 'Assemble milestone deliverable package and formal sign-off record',
      category: 'delivery',
      roleKey: 'role:account-lead',
      documentKey: 'doc:sow-template',
      minutes: 75,
      priority: 'high',
      detail: 'Compile repository tags, staging demo links, QA test summary, and change log into the formal milestone delivery package for client sign-off under SOW terms.',
      outcome: 'Formally transmitted milestone deliverable package logged with the 5-day review countdown initiated.',
    },
  ],
}
