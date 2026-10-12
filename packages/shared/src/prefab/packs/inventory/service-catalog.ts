import type { PrefabInventory, PrefabPack } from '../../schemas'

export const serviceCatalogInventoryPack: PrefabPack<PrefabInventory> = {
  id: 'pack.inventory.service-catalog',
  domain: 'inventory',
  name: 'Agency Service Catalog & Retainers',
  description: 'Packaged commercial service products, fixed-scope sprint blocks, and monthly advisory retainers.',
  records: [
    {
      key: 'inv:service-discovery-sprint',
      packId: 'pack.inventory.service-catalog',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      name: 'Two-Week Technical & Design Discovery Sprint',
      sku: 'SRV-DISCOVERY-2W',
      description: 'Fixed-scope diagnostic deliverable establishing architectural blueprint, user journey maps, and sprint backlog.',
      price: 6000.00,
      category: 'Service Offerings',
      quantity: 12, // available capacity slots
      availability: 'in_stock',
    },
    {
      key: 'inv:service-delivery-sprint',
      packId: 'pack.inventory.service-catalog',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      name: 'Full-Stack Implementation Sprint Block (80 Hours)',
      sku: 'SRV-SPRINT-80H',
      description: 'Dedicated two-week engineering and design sprint producing tangible code milestones and staging deployments.',
      price: 14000.00,
      category: 'Service Offerings',
      quantity: 6,
      availability: 'in_stock',
    },
    {
      key: 'inv:service-retainer-advisory',
      packId: 'pack.inventory.service-catalog',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      name: 'Monthly Fractional Architectural Advisory Retainer (20 Hours)',
      sku: 'SRV-RETAINER-20H',
      description: 'Ongoing technical oversight, senior architectural reviews, emergency escalation, and executive roadmapping.',
      price: 4500.00,
      category: 'Service Offerings',
      quantity: 4,
      availability: 'in_stock',
    },
  ],
}
