import type { PrefabPack, PrefabTask } from '../../schemas'

export const soloTasksPack: PrefabPack<PrefabTask> = {
  id: 'pack.tasks.solo-delivery',
  domain: 'tasks',
  name: 'Solo Practice Delivery & Cadence',
  description: 'Advisory client intake, milestone deliverables, and billing routine tasks.',
  records: [
    {
      key: 'task:solo-intake-screening',
      packId: 'pack.tasks.solo-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:solo-owner'],
      },
      title: 'Screen inbound inquiry and score against qualification rubric',
      category: 'onboarding',
      roleKey: 'role:solo-owner',
      minutes: 45,
      priority: 'high',
      detail: 'Review prospect inquiry, check budget thresholds, decision-maker authority, and technical criteria against written qualification scorecard.',
      outcome: 'A qualification scorecard attached to CRM contact records determining whether to schedule a paid discovery session.',
    },
    {
      key: 'task:solo-discovery-workshop',
      packId: 'pack.tasks.solo-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:solo-owner'],
      },
      title: 'Facilitate client discovery session and document technical constraints',
      category: 'delivery',
      roleKey: 'role:solo-owner',
      minutes: 120,
      priority: 'high',
      detail: 'Lead a two-hour discovery workshop to surface stakeholder goals, technical architecture, and measurable business outcomes.',
      outcome: 'A documented discovery facilitation synthesis and approved scope baseline.',
    },
    {
      key: 'task:solo-advisory-deliverable',
      packId: 'pack.tasks.solo-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:solo-owner'],
      },
      title: 'Author primary strategic deliverable and executive summary',
      category: 'delivery',
      roleKey: 'role:solo-owner',
      minutes: 180,
      priority: 'high',
      detail: 'Execute research, system analysis, and recommendation chapters according to agreed statement of work.',
      outcome: 'A complete first-draft advisory deliverable package ready for client executive review.',
    },
    {
      key: 'task:solo-weekly-reconciliation',
      packId: 'pack.tasks.solo-delivery',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:solo-bookkeeper'],
      },
      title: 'Reconcile weekly banking receipts and issue milestone invoices',
      category: 'operations',
      roleKey: 'role:solo-bookkeeper',
      minutes: 60,
      priority: 'normal',
      detail: 'Match bank deposits against open invoices, follow up on outstanding balances, and log software receipts.',
      outcome: 'An updated accounts receivable ledger with zero unallocated receipts and reconciled cashflow projection.',
    },
  ],
}
