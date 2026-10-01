import { create } from 'zustand'
import type { Item } from '../api/types'
import { chronological } from '../utils/graph'

export type ItemsById = Record<string, Item>

export type DataState = {
  itemsById: ItemsById
  orderedIds: string[]
  
  addItem: (item: Item) => void
  upsertItem: (item: Item) => void
  removeItem: (id: string) => void
  replaceItems: (items: Item[]) => void
}

export const useData = create<DataState>((set) => ({
  itemsById: {},
  orderedIds: [],

  addItem: (item) => set((state) => {
    if (state.itemsById[item.id]) return state
    
    const newItemsById = { ...state.itemsById, [item.id]: item }
    
    // Fast O(N) insertion into sorted array instead of O(N log N) re-sort
    const orderedIds = [...state.orderedIds]
    let inserted = false
    // Most new items are newer than everything else, check from the end O(1) best case
    for (let i = orderedIds.length - 1; i >= 0; i--) {
      const currentItem = state.itemsById[orderedIds[i]]
      if (currentItem && currentItem.createdAt <= item.createdAt) {
        orderedIds.splice(i + 1, 0, item.id)
        inserted = true
        break
      }
    }
    if (!inserted) orderedIds.unshift(item.id)

    return { itemsById: newItemsById, orderedIds }
  }),

  upsertItem: (item) => set((state) => {
    const newItemsById = { ...state.itemsById, [item.id]: item }
    
    if (state.itemsById[item.id]) {
      // If it exists, orderedIds is already correct (unless createdAt changes, which it shouldn't)
      return { itemsById: newItemsById, orderedIds: state.orderedIds }
    }

    // Fast O(N) insertion
    const orderedIds = [...state.orderedIds]
    let inserted = false
    for (let i = orderedIds.length - 1; i >= 0; i--) {
      const currentItem = state.itemsById[orderedIds[i]]
      if (currentItem && currentItem.createdAt <= item.createdAt) {
        orderedIds.splice(i + 1, 0, item.id)
        inserted = true
        break
      }
    }
    if (!inserted) orderedIds.unshift(item.id)

    return { itemsById: newItemsById, orderedIds }
  }),

  removeItem: (id) => set((state) => {
    if (!state.itemsById[id]) return state
    const newItemsById = { ...state.itemsById }
    delete newItemsById[id]
    return {
      itemsById: newItemsById,
      orderedIds: state.orderedIds.filter(i => i !== id)
    }
  }),

  replaceItems: (items) => set(() => {
    const itemsById: ItemsById = {}
    const orderedIds: string[] = []
    
    const sorted = chronological(items)
    for (const item of sorted) {
      itemsById[item.id] = item
      orderedIds.push(item.id)
    }

    return { itemsById, orderedIds }
  })
}))

// Selectors
export const selectAllItems = (state: DataState) => 
  state.orderedIds.map(id => state.itemsById[id]).filter(Boolean)
