import type { PrefabRecord } from './meta'

export type PrefabInventoryData = {
  name: string
  sku: string
  description: string
  price: number
  category: string
  quantity: number
  availability: 'in_stock' | 'low_stock' | 'out_of_stock'
}

export type PrefabInventory = PrefabRecord<PrefabInventoryData>
