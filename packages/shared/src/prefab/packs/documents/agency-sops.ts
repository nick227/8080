import type { PrefabDocument, PrefabPack } from '../../schemas'

export const agencySopsPack: PrefabPack<PrefabDocument> = {
  id: 'pack.documents.agency-sops',
  domain: 'documents',
  name: 'Agency Standard Operating Procedures',
  description: 'Operating manuals and playbooks for onboarding clients and managing weekly delivery.',
  records: [
    {
      key: 'doc:client-onboarding-sop',
      packId: 'pack.documents.agency-sops',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      title: 'Standard Operating Procedure: Client Onboarding & Project Kickoff',
      kind: 'sop',
      summary: 'Step-by-step checklist and governance guide for transitioning signed deals into active sprint delivery.',
      requiresReview: false,
      content: `# SOP: CLIENT ONBOARDING & PROJECT KICKOFF

## 1. Commercial Clearance (Day 0)
1. Verify signed MSA and initial milestone deposit / SOW execution.
2. Confirm Client primary billing contact and technical point of contact.
3. Create dedicated workspace record and link billing milestones.

## 2. Infrastructure & Access Setup (Day 1–2)
1. Establish private communication channel (e.g., Slack Connect or shared workspace).
2. Provision repository branches and staging environment URLs.
3. Invite key client stakeholders with appropriate access roles.

## 3. Kickoff Alignment Meeting (Day 3)
1. Review agreed milestone delivery dates, sprint cadence, and weekly sync time.
2. Reiterate the 5-day client review and acceptance window.
3. Document initial risk log and client-side dependencies.
`,
    },
    {
      key: 'doc:weekly-operating-cadence',
      packId: 'pack.documents.agency-sops',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      title: 'Agency Operating Rhythm & Weekly Cadence Guide',
      kind: 'sop',
      summary: 'Structured weekly operational rhythm balancing engineering delivery, client touchpoints, and financial hygiene.',
      requiresReview: false,
      content: `# AGENCY OPERATING RHYTHM & WEEKLY CADENCE

## Monday: Sprint Alignment & Commitment
- **09:00 - 09:45 AM**: Weekly Team Standup & Milestone Priorities review.
- Focus: Unblock technical blockers, review client deliverables due by Thursday.

## Tuesday - Thursday: Deep Delivery & Engineering Flow
- Protected focus blocks for engineering and design delivery.
- Mid-week asynchronous client progress check-in sent by Account Lead every Wednesday by 4:00 PM.

## Friday: Financial Hygiene & Retrospective
- **10:00 - 11:00 AM**: Finance Review: Milestone billing, invoice aging, and time audit.
- **02:00 - 03:00 PM**: Internal Retrospective: Velocity check and upcoming week capacity commitments.
`,
    },
  ],
}
