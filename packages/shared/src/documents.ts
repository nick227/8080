/** Documents v1 backend contract. OpenAPI schemas mirror these wire types;
 * response-contract tests and the generated SDK are the consumer boundary. */
export const CONTACT_COLUMNS = ['id', 'firstName', 'lastName', 'displayName', 'title', 'primaryEmail', 'primaryPhone', 'status', 'createdAt', 'updatedAt'] as const
export type ContactColumn = typeof CONTACT_COLUMNS[number]
export type ContactsQuery = {
  columns: ContactColumn[]
  filters?: { q?: string; status?: 'active' | 'archived'; ownerMemberId?: string; importBatchId?: string; date?: { field: 'createdAt' | 'updatedAt'; from: string; to: string } }
  sort?: { field: 'id' | 'displayName' | 'createdAt' | 'updatedAt'; direction: 'asc' | 'desc' }
}
export type DocumentDescriptor =
  | { surface: 'blocks' | 'mental_map' | 'grid'; source: { kind: 'native'; schemaVersion: 1 } }
  | { surface: 'grid'; source: { kind: 'dataset'; datasetKey: 'contacts'; datasetVersion: 1; query: ContactsQuery } }
  | { surface: 'external'; source: { kind: 'external'; provider: 'google_docs' | 'google_sheets'; url: string } }
export type DocumentCreate = { title: string; descriptor: DocumentDescriptor; idempotencyKey: string }
export type DocumentPatch = { expectedVersion: number; title?: string; descriptor?: DocumentDescriptor }
export type DatasetWrite = { expectedVersion: number; idempotencyKey: string; changes: { firstName?: string | null; lastName?: string | null; displayName?: string | null; title?: string | null } }
export type GridTable = { columns: { id: string; label: string; type: 'text' }[]; rows: { id: string; cells: Record<string, string | null> }[] }
export type QueryManifest = { datasetKey: 'contacts'; datasetVersion: 1; query: ContactsQuery; capturedAt: string; timezone: string; rowCount: number; complete: true }
