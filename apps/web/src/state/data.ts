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

// Only clone child lists whose membership changes. Missing-parent buckets retain
// live children so loading/reinserting their parent restores the relationship.
function detachChild(children: DataState['childrenById'], parentId: string, id: string) {
  const siblings = children[parentId]?.filter(child => child !== id)
  if (siblings?.length) children[parentId] = siblings
  else delete children[parentId]
}

function insertItem(state: DataState, item: Item) {
  const itemsById = { ...state.itemsById, [item.id]: item }
  const orderedIds = [...state.orderedIds]
  const orderedItems = [...state.orderedItems]
  let at = orderedItems.length
  while (at > 0 && orderedItems[at - 1].createdAt > item.createdAt) at--
  orderedIds.splice(at, 0, item.id)
  orderedItems.splice(at, 0, item)
  let childrenById = state.childrenById
  if (item.parentId) {
    childrenById = { ...childrenById }
    childrenById[item.parentId] = [...(childrenById[item.parentId] ?? []), item.id]
  }
  return { itemsById, orderedIds, orderedItems, childrenById }
}

export const useData = create<DataState>((set) => ({
  itemsById: {},
  orderedIds: [],
  orderedItems: [],
  childrenById: {},

  addItem: (item) => set((state) => state.itemsById[item.id] ? state : insertItem(state, item)),

  upsertItem: (item) => set((state) => {
    const existing = state.itemsById[item.id]
    if (!existing) return insertItem(state, item)
    if (existing === item) return state
    let childrenById = state.childrenById
    if (existing.parentId !== item.parentId) {
      childrenById = { ...childrenById }
      if (existing.parentId) detachChild(childrenById, existing.parentId, item.id)
      if (item.parentId) childrenById[item.parentId] = [...(childrenById[item.parentId] ?? []), item.id]
    }
    const orderedItems = state.orderedItems.map(current => current.id === item.id ? item : current)
    return { itemsById: { ...state.itemsById, [item.id]: item }, orderedItems, childrenById }
  }),

  removeItem: (id) => set((state) => {
    if (!state.itemsById[id]) return state
    const newItemsById = { ...state.itemsById }
    delete newItemsById[id]
    
    const orderedIds = state.orderedIds.filter(i => i !== id)
    const orderedItems = orderedIds.map(itemId => newItemsById[itemId])
    
    const parentId = state.itemsById[id].parentId
    let childrenById = state.childrenById
    if (parentId) {
      childrenById = { ...childrenById }
      detachChild(childrenById, parentId, id)
    }
    return {
      itemsById: newItemsById,
      orderedIds,
      orderedItems,
      childrenById
    }
  }),

  replaceItems: (items) => set(() => {
    const itemsById: ItemsById = {}
    const orderedIds: string[] = []
    const childrenById: Record<string, string[]> = {}
    const orderedItems = chronological(items)
    for (const item of orderedItems) {
      itemsById[item.id] = item
      orderedIds.push(item.id)
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
