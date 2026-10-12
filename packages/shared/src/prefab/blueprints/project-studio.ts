import type { PrefabBlueprint } from '../schemas'

export const projectStudioBlueprint: PrefabBlueprint = {
  id: 'blueprint.project-studio',
  slug: 'project-studio',
  name: 'Project Studio',
  subtitle: 'A five-person digital product studio managing sprint milestones and scope governance.',
  description: 'A five-person studio manages client pipelines, staged milestone sprints, design system delivery, and commercial project governance.',
  packs: {
    team: ['pack.team.studio-roles'],
    tasks: ['pack.tasks.agency-delivery', 'pack.tasks.agency-operations'],
    contacts: ['pack.contacts.public-institutions'],
    inventory: ['pack.inventory.agency-equipment', 'pack.inventory.service-catalog'],
    documents: ['pack.documents.client-agreements', 'pack.documents.agency-sops'],
    automations: ['pack.automations.agency-workflows'],
  },
}
