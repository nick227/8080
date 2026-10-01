import type { Item } from '../api/types';

export type ItemsById = Record<string, Item>;

// Fast chronological sort using string comparison (ISO 8601 dates sort correctly without Date parsing)
export function chronological(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0));
}

// buildChildrenMap was removed to avoid O(N^2) churn. childrenById is now maintained in the state.

// Returns all direct children of a given parent ID using the pre-built childrenById map
export function childrenOf(itemsById: ItemsById, childrenById: Record<string, string[]>, parentId: string): Item[] {
  const ids = childrenById[parentId] || [];
  return ids.map(id => itemsById[id]).filter(Boolean);
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
export function branchOf(itemsById: ItemsById, childrenById: Record<string, string[]>, rootId: string): Item[] {
  const root = itemsById[rootId];
  if (!root) return [];

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
      let children = childrenById[currentId] || [];
      // To process siblings chronologically, we push them onto the stack in reverse chronological order
      if (children.length > 0) {
        children = [...children].sort((a, b) => itemsById[a].createdAt < itemsById[b].createdAt ? 1 : -1);
        for (const child of children) {
          stack.push(child);
        }
      }
    }
  }

  return branch; // Already in strict depth-first order
}

// Counts all nested replies (descendants) of a given item.
export function replyCount(itemsById: ItemsById, childrenById: Record<string, string[]>, itemId: string): number {
  const branch = branchOf(itemsById, childrenById, itemId);
  return Math.max(0, branch.length - 1); // Subtract the root itself
}

// Fast calculation of depth without array allocations
export function depthOf(itemsById: ItemsById, itemId: string): number {
  let depth = 0;
  let currentId = itemsById[itemId]?.parentId;
  const seen = new Set<string>([itemId]);
  
  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    
    const parent = itemsById[currentId];
    if (!parent) break;
    
    depth++;
    currentId = parent.parentId;
  }
  return depth;
}
