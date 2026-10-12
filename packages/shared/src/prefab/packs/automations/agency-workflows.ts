import type { PrefabAutomation, PrefabPack } from '../../schemas'

export const agencyWorkflowsAutomationsPack: PrefabPack<PrefabAutomation> = {
  id: 'pack.automations.agency-workflows',
  domain: 'automations',
  name: 'Agency Operating & Sales Automations',
  description: 'Pre-configured, inactive automated workflows for team standups, deal dormancy, and client reviews.',
  records: [
    {
      key: 'auto:daily-team-brief',
      packId: 'pack.automations.agency-workflows',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:lead-engineer', 'role:account-lead'],
      },
      name: 'Daily Morning Team Briefing',
      family: 'scheduled',
      typeKey: 'daily_team_brief',
      scheduleHint: 'Mon–Fri at 08:30',
      description: 'Compiles open sprint tickets, milestone deadlines due within 48 hours, and new inbound contacts into a morning summary.',
      config: {
        targetChannel: 'general',
        includeTasks: true,
        includeContacts: true,
      },
      status: 'inactive',
    },
    {
      key: 'auto:stale-contact-followup',
      packId: 'pack.automations.agency-workflows',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:agency-director'],
      },
      name: 'Proposal Dormancy Monitor & Account Alert',
      family: 'followup',
      typeKey: 'checkin_no_reply',
      scheduleHint: 'Triggered after 5 business days without reply',
      description: 'Monitors prospective contacts in Proposal Sent stage. When inactive for 5+ business days, queues an executive follow-up prompt.',
      config: {
        inactivityDays: 5,
        targetStage: 'proposalSent',
        autoDraftEmail: true,
      },
      status: 'inactive',
    },
    {
      key: 'auto:client-delivery-review',
      packId: 'pack.automations.agency-workflows',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      refs: {
        roles: ['role:account-lead'],
        documents: ['doc:sow-template'],
      },
      name: 'Client Milestone Feedback & Testimonial Request',
      family: 'followup',
      typeKey: 'ask_for_review',
      scheduleHint: 'Triggered upon milestone deliverable sign-off',
      description: 'Triggers a personalized satisfaction review check-in and case study permission request following milestone handover.',
      config: {
        delayHoursAfterDone: 24,
      },
      status: 'inactive',
    },
  ],
}
