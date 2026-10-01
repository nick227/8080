import { create } from 'zustand'
import type { Item } from '../api/types'
import { chronological } from '../utils/graph'

export type ItemsById = Record<string, Item>

export type DataState = {
  itemsById: ItemsById
  orderedIds: string[]
  orderedItems: Item[]
  childrenById: Record<string, string[]>
  
  addItem: (item: Item) => void
  upsertItem: (item: Item) => void
  removeItem: (id: string) => void
  replaceItems: (items: Item[]) => void
}

export const useData = create<DataState>((set) => ({
  itemsById: {},
  orderedIds: [],
  orderedItems: [],
  childrenById: {},

  addItem: (item) => set((state) => {
    if (state.itemsById[item.id]) return state
    
    const newItemsById = { ...state.itemsById, [item.id]: item }
    const childrenById = { ...state.childrenById }
    
    if (item.parentId) {
      const arr = childrenById[item.parentId] || []
      if (!arr.includes(item.id)) {
        childrenById[item.parentId] = [...arr, item.id]
      }
    }
    
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

    const orderedItems = orderedIds.map(id => newItemsById[id])

    return { itemsById: newItemsById, orderedIds, orderedItems, childrenById }
  }),

  upsertItem: (item) => set((state) => {
    const newItemsById = { ...state.itemsById, [item.id]: item }
    let childrenById = state.childrenById
    
    if (!state.itemsById[item.id] && item.parentId) {
      // It's technically an add if it didn't exist
      childrenById = { ...state.childrenById }
      const arr = childrenById[item.parentId] || []
      if (!arr.includes(item.id)) {
        childrenById[item.parentId] = [...arr, item.id]
      }
    }
    
    if (state.itemsById[item.id]) {
      // If it exists, orderedIds is already correct (unless createdAt changes, which it shouldn't)
      const orderedItems = state.orderedIds.map(id => newItemsById[id])
      return { itemsById: newItemsById, orderedIds: state.orderedIds, orderedItems, childrenById }
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

    const orderedItems = orderedIds.map(id => newItemsById[id])

    return { itemsById: newItemsById, orderedIds, orderedItems, childrenById }
  }),

  removeItem: (id) => set((state) => {
    if (!state.itemsById[id]) return state
    const newItemsById = { ...state.itemsById }
    delete newItemsById[id]
    
    const orderedIds = state.orderedIds.filter(i => i !== id)
    const orderedItems = orderedIds.map(itemId => newItemsById[itemId])
    
    // We don't strictly clean up childrenById for performance, 
    // dangling IDs won't be mapped because they are deleted from itemsById
    return {
      itemsById: newItemsById,
      orderedIds,
      orderedItems
    }
  }),

  replaceItems: (items) => set(() => {
    const itemsById: ItemsById = {}
    const orderedIds: string[] = []
    const childrenById: Record<string, string[]> = {}
    const orderedItems: Item[] = []
    
    const sorted = chronological(items)
    for (const item of sorted) {
      itemsById[item.id] = item
      orderedIds.push(item.id)
      orderedItems.push(item)
      if (item.parentId) {
        if (!childrenById[item.parentId]) childrenById[item.parentId] = []
        childrenById[item.parentId].push(item.id)
      }
    }

    return { itemsById, orderedIds, orderedItems, childrenById }
  })
}))

// Selectors
// Avoids recreating a new array on every state update
export const selectAllItems = (state: DataState) => state.orderedItems
