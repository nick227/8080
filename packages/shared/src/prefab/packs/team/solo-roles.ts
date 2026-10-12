import type { PrefabPack, PrefabTeamRole } from '../../schemas'

export const soloRolesPack: PrefabPack<PrefabTeamRole> = {
  id: 'pack.team.solo-roles',
  domain: 'team',
  name: 'Solo Operator Roles & Support',
  description: 'Practice owner role and fractional bookkeeping support for an independent advisory practice.',
  records: [
    {
      key: 'role:solo-owner',
      packId: 'pack.team.solo-roles',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      roleTitle: 'Lead Consultant & Practice Owner',
      department: 'Advisory & Strategy',
      responsibilities: 'Qualifies client inquiries, executes primary advisory deliverables, leads business development, and directs practice strategy.',
      hoursPerWeek: 32,
      estimatedRate: {
        amount: 15000,
        period: 'month',
        currency: 'USD',
      },
      requiredSkills: [
        'Strategic Consulting',
        'Executive Client Advisory',
        'Proposal Drafting',
        'Practice Operations',
      ],
      isVacant: true,
    },
    {
      key: 'role:solo-bookkeeper',
      packId: 'pack.team.solo-roles',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      roleTitle: 'Bookkeeper & Administrative Specialist (Fractional)',
      department: 'Finance & Administration',
      responsibilities: 'Reconciles weekly banking transactions, issues monthly invoices, tracks accounts receivable aging, and assists with tax compliance.',
      hoursPerWeek: 6,
      estimatedRate: {
        amount: 1200,
        period: 'month',
        currency: 'USD',
      },
      requiredSkills: [
        'Bookkeeping & Accounting Reconciliation',
        'Invoicing & Accounts Receivable',
        'Financial Reporting',
      ],
      isVacant: true,
    },
  ],
}
