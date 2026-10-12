import type { PrefabPack, PrefabTeamRole } from '../../schemas'

export const studioRolesPack: PrefabPack<PrefabTeamRole> = {
  id: 'pack.team.studio-roles',
  domain: 'team',
  name: 'Studio Core Staffing Roles',
  description: 'Production makers, directors, and commercial management roles for a 5-person digital product studio.',
  records: [
    {
      key: 'role:studio-producer',
      packId: 'pack.team.studio-roles',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      roleTitle: 'Executive Producer & Account Director',
      department: 'Client Services & Governance',
      responsibilities: 'Directs client relationships, negotiates commercial contracts, manages sprint schedules, and monitors project profitability.',
      hoursPerWeek: 34,
      estimatedRate: {
        amount: 13000,
        period: 'month',
        currency: 'USD',
      },
      requiredSkills: [
        'Contract Governance',
        'Sprint Production Management',
        'Client Negotiation',
        'Studio Margin Analysis',
      ],
      isVacant: true,
    },
    {
      key: 'role:studio-director',
      packId: 'pack.team.studio-roles',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      roleTitle: 'Design Director',
      department: 'Design Leadership',
      responsibilities: 'Sets creative direction, chairs design critique reviews, enforces system token architecture, and leads client presentations.',
      hoursPerWeek: 36,
      estimatedRate: {
        amount: 14000,
        period: 'month',
        currency: 'USD',
      },
      requiredSkills: [
        'Creative Direction',
        'Design System Token Architecture',
        'Executive Presentations',
        'Accessibility Standards',
      ],
      isVacant: true,
    },
    {
      key: 'role:studio-maker',
      packId: 'pack.team.studio-roles',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      roleTitle: 'Senior Designer & Systems Maker',
      department: 'Design Production',
      responsibilities: 'Builds design tokens, Figma component systems, interactive prototypes, and production delivery packages.',
      hoursPerWeek: 36,
      estimatedRate: {
        amount: 11000,
        period: 'month',
        currency: 'USD',
      },
      requiredSkills: [
        'Figma Component Architecture',
        'Design Tokens',
        'Interactive Prototyping',
        'Design Handoff Documentation',
      ],
      isVacant: true,
    },
  ],
}
