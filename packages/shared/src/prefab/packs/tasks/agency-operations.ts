import type { PrefabPack, PrefabTask } from '../../schemas'

export const agencyOperationsTasksPack: PrefabPack<PrefabTask> = {
  id: 'pack.tasks.agency-operations',
  domain: 'tasks',
  name: 'Agency Commercial & Operations Tasks',
  description: 'Business development, client qualification, invoicing routine, and financial governance tasks.',
  records: [
    {
      key: 'task:inbound-lead-qualification',
      packId: 'pack.tasks.agency-operations',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:agency-director'],
        documents: ['doc:msa-template'],
      },
      title: 'Qualify inbound prospect against commercial fit rubric and budget floor',
      category: 'sales',
      roleKey: 'role:agency-director',
      minutes: 45,
      priority: 'high',
      detail: 'Evaluate prospect request against technical capabilities, budget minimum ($15,000 threshold), and stakeholder decision authority prior to scheduling a diagnostic workshop.',
      outcome: 'A completed qualification scorecard attached to the CRM contact record, with clear go/no-go determination.',
    },
    {
      key: 'task:weekly-invoicing-routine',
      packId: 'pack.tasks.agency-operations',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:operations-cfo'],
        documents: ['doc:msa-template'],
      },
      title: 'Execute weekly invoice dispatch and accounts receivable aging audit',
      category: 'finance',
      roleKey: 'role:operations-cfo',
      documentKey: 'doc:msa-template',
      repeat: 4, // Friday
      minutes: 60,
      priority: 'high',
      detail: 'Review verified milestone approvals, draft billing invoices according to Net-15 terms, send payment reminders for aging items > 15 days, and reconcile bank deposits.',
      outcome: 'Updated accounts receivable ledger with all milestone invoices dispatched and cashflow projections adjusted.',
    },
    {
      key: 'task:client-onboarding-kickoff',
      packId: 'pack.tasks.agency-operations',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:account-lead'],
        documents: ['doc:client-onboarding-sop'],
      },
      title: 'Execute Day 1 client kickoff sequence per onboarding SOP',
      category: 'operations',
      roleKey: 'role:account-lead',
      documentKey: 'doc:client-onboarding-sop',
      minutes: 60,
      priority: 'normal',
      detail: 'Provision client communication channels, verify countersigned MSA and SOW deposit, establish shared repository permissions, and issue calendar invites for kickoff.',
      outcome: 'Client workspace fully provisioned with access verified and kickoff meeting confirmed on calendar.',
    },
    {
      key: 'task:monthly-pnl-review',
      packId: 'pack.tasks.agency-operations',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:operations-cfo', 'role:agency-director'],
      },
      title: 'Conduct monthly agency gross margin and contractor spend review',
      category: 'finance',
      roleKey: 'role:operations-cfo',
      minutes: 90,
      priority: 'high',
      detail: 'Reconcile project revenue against payroll, contractor disbursements, and software overhead. Calculate effective blended hourly rate and rolling 90-day cash buffer.',
      outcome: 'Monthly financial summary document presented to leadership with rolling 90-day cash buffer confirmation.',
    },
  ],
}
