import type { Item } from '../api/types';

export type ItemsById = Record<string, Item>;

// Fast chronological sort using string comparison (ISO 8601 dates sort correctly without Date parsing)
export function chronological(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0));
}

// Builds an optimized parent -> children map for O(1) lookup during traversals
function buildChildrenMap(itemsById: ItemsById): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id in itemsById) {
    const parentId = itemsById[id].parentId;
    if (parentId) {
      const children = map.get(parentId);
      if (children) children.push(id);
      else map.set(parentId, [id]);
    }
  }
  return map;
}

// Returns all direct children of a given parent ID
export function childrenOf(itemsById: ItemsById, parentId: string): Item[] {
  const children: Item[] = [];
  for (const id in itemsById) {
    if (itemsById[id].parentId === parentId) {
      children.push(itemsById[id]);
    }
  }
  return children;
}

// Returns all ancestors of a given item, from direct parent up to root.
// Safely handles cycles, self-parents, and missing parents.
export function ancestorsOf(itemsById: ItemsById, itemId: string): Item[] {
  const ancestors: Item[] = [];
  // Seeded with the start so a cycle back through it (or a self-parent) stops cleanly.
  const seen = new Set<string>([itemId]);
  
  let currentId = itemsById[itemId]?.parentId;

  while (currentId) {
    if (seen.has(currentId)) break; // Cycle / self-parent detected
    seen.add(currentId);

    const parent = itemsById[currentId];
    if (!parent) break; // Missing parent / orphaned

    ancestors.push(parent);
    currentId = parent.parentId;
  }

  return ancestors;
}

// Returns the full branch starting from a root node down through all descendants.
// Traverses strictly chronologically depth-first so playback follows the true narrative thread.
export function branchOf(itemsById: ItemsById, rootId: string): Item[] {
  const root = itemsById[rootId];
  if (!root) return [];

  const childrenMap = buildChildrenMap(itemsById);
  const branch: Item[] = [];
  const stack: string[] = [rootId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    
    const item = itemsById[currentId];
    if (item) {
      branch.push(item);
      let children = childrenMap.get(currentId) || [];
      // To process siblings chronologically, we push them onto the stack in reverse chronological order
      if (children.length > 0) {
        children = children.sort((a, b) => itemsById[a].createdAt < itemsById[b].createdAt ? 1 : -1);
        for (const child of children) {
          stack.push(child);
        }
      }
    }
  }

  return branch; // Already in strict depth-first order
}

// Counts all nested replies (descendants) of a given item.
export function replyCount(itemsById: ItemsById, itemId: string): number {
  const branch = branchOf(itemsById, itemId);
  return Math.max(0, branch.length - 1); // Subtract the root itself
}
