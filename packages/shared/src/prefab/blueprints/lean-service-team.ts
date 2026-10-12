import type { PrefabBlueprint } from '../schemas'

export const leanServiceTeamBlueprint: PrefabBlueprint = {
  id: 'blueprint.lean-service-team',
  slug: 'lean-service-team',
  name: 'Service Team',
  subtitle: 'A full-stack, 5-person digital services agency operating model.',
  description: 'Starter data',
  packs: {
    team: ['pack.team.agency-roles'],
    tasks: ['pack.tasks.agency-delivery', 'pack.tasks.agency-operations'],
    contacts: ['pack.contacts.public-institutions'],
    inventory: ['pack.inventory.agency-equipment', 'pack.inventory.service-catalog'],
    documents: ['pack.documents.client-agreements', 'pack.documents.agency-sops'],
    automations: ['pack.automations.agency-workflows'],
  },
}
