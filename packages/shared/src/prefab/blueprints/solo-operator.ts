import type { PrefabBlueprint } from '../schemas'

export const soloOperatorBlueprint: PrefabBlueprint = {
  id: 'blueprint.solo-operator',
  slug: 'solo-operator',
  name: 'Solo Operator',
  subtitle: 'A structured 90-day operating model for an independent specialized consultancy.',
  description: 'An independent practitioner balances business development, client delivery, invoicing, and operational administration with external bookkeeping support.',
  packs: {
    team: ['pack.team.solo-roles'],
    tasks: ['pack.tasks.solo-delivery'],
    contacts: ['pack.contacts.public-institutions'],
    inventory: ['pack.inventory.service-catalog'],
    documents: ['pack.documents.client-agreements', 'pack.documents.agency-sops'],
    automations: ['pack.automations.agency-workflows'],
  },
}
