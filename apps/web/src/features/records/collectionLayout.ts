/** Collection presentation: list vs image cards. Remembered per workspace + domain. */

export type CollectionLayout = 'list' | 'grid'

const defaults: Record<'contacts' | 'inventory', CollectionLayout> = {
  contacts: 'list',
  inventory: 'grid',
}

const key = (workspaceId: string, kind: 'contacts' | 'inventory') =>
  `records.layout:${workspaceId}:${kind}`

export function defaultLayout(kind: 'contacts' | 'inventory'): CollectionLayout {
  return defaults[kind]
}

export function loadLayout(
  workspaceId: string,
  kind: 'contacts' | 'inventory',
): CollectionLayout {
  try {
    const stored = localStorage.getItem(key(workspaceId, kind))
    if (stored === 'list' || stored === 'grid') return stored
  } catch {
    /* use default */
  }
  return defaultLayout(kind)
}

export function saveLayout(
  workspaceId: string,
  kind: 'contacts' | 'inventory',
  layout: CollectionLayout,
) {
  try {
    localStorage.setItem(key(workspaceId, kind), layout)
  } catch {
    /* choice still applies for this visit */
  }
}
