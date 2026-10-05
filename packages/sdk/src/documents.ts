// Framework-independent platform client. Editors use the same generated contract.
import { getApiClient, unwrap } from './client'
import type { components, operations } from './generated/types'
type S = components['schemas']
export const documentsApi = {
  list: async (workspaceId: string, query?: operations['listDocuments']['parameters']['query']) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents', { params: { path: { workspaceId }, query } })),
  get: async (workspaceId: string, documentId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}', { params: { path: { workspaceId, documentId } } })).data,
  create: async (workspaceId: string, body: S['CreateDocumentInput']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/documents', { params: { path: { workspaceId } }, body })).data,
  update: async (workspaceId: string, documentId: string, body: S['UpdateDocumentInput']) => unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/documents/{documentId}', { params: { path: { workspaceId, documentId } }, body })).data,
  remove: async (workspaceId: string, documentId: string, expectedVersion: number) => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/documents/{documentId}', { params: { path: { workspaceId, documentId } }, body: { expectedVersion } })).data,
  restore: async (workspaceId: string, documentId: string, expectedVersion: number) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/documents/{documentId}/restore', { params: { path: { workspaceId, documentId } }, body: { expectedVersion } })).data,
  grants: async (workspaceId: string, documentId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}/grants', { params: { path: { workspaceId, documentId } } })).data,
  setGrant: async (workspaceId: string, documentId: string, memberId: string, role: 'viewer' | 'editor') => unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/documents/{documentId}/grants/{memberId}', { params: { path: { workspaceId, documentId, memberId } }, body: { role } })),
  removeGrant: async (workspaceId: string, documentId: string, memberId: string) => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/documents/{documentId}/grants/{memberId}', { params: { path: { workspaceId, documentId, memberId } } })),
  rooms: async (workspaceId: string, documentId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}/rooms', { params: { path: { workspaceId, documentId } } })).data,
  linkRoom: async (workspaceId: string, documentId: string, roomId: string) => unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/documents/{documentId}/rooms/{roomId}', { params: { path: { workspaceId, documentId, roomId } } })),
  unlinkRoom: async (workspaceId: string, documentId: string, roomId: string) => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/documents/{documentId}/rooms/{roomId}', { params: { path: { workspaceId, documentId, roomId } } })),
  related: async (workspaceId: string, documentId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}/related', { params: { path: { workspaceId, documentId } } })).data,
  relate: async (workspaceId: string, documentId: string, relatedDocumentId: string) => unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/documents/{documentId}/related/{relatedDocumentId}', { params: { path: { workspaceId, documentId, relatedDocumentId } } })),
  unrelate: async (workspaceId: string, documentId: string, relatedDocumentId: string) => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/documents/{documentId}/related/{relatedDocumentId}', { params: { path: { workspaceId, documentId, relatedDocumentId } } })),
  importCsv: async (workspaceId: string, body: S['ImportDocumentCsvInput']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/documents/import-csv', { params: { path: { workspaceId } }, body })).data,
  materialization: async (workspaceId: string, documentId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/documents/{documentId}/materialization', { params: { path: { workspaceId, documentId } } })).data,
  query: async (workspaceId: string, documentId: string, body: S['DocumentDatasetQueryInput'] = {}) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/documents/{documentId}/query', { params: { path: { workspaceId, documentId } }, body })),
  updateRow: async (workspaceId: string, documentId: string, contactId: string, body: S['DatasetWriteInput']) => unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/documents/{documentId}/rows/{contactId}', { params: { path: { workspaceId, documentId, contactId } }, body })).data,
}
export const documentDatasetsApi = {
  list: async (workspaceId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/document-datasets', { params: { path: { workspaceId } } })).data,
  queryContacts: async (workspaceId: string, body: S['DatasetQueryInput']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/document-datasets/contacts/query', { params: { path: { workspaceId } }, body })),
  updateContact: async (workspaceId: string, contactId: string, body: S['DatasetWriteInput']) => unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/document-datasets/contacts/rows/{contactId}', { params: { path: { workspaceId, contactId } }, body })).data,
  exportContacts: async (workspaceId: string, query: S['ContactsDatasetQuery']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/document-datasets/contacts/export', { params: { path: { workspaceId } }, body: { query } })).data,
  reviewContacts: async (workspaceId: string, body: S['CreateContactsReviewInput']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/document-datasets/contacts/review-copy', { params: { path: { workspaceId } }, body })).data,
}
// "Import as contacts" (doc/10 §7A): preview → decide review rows → commit. An
// ordinary sheet import (documentsApi.importCsv) never creates contacts; pass its
// document id as the source here to turn a reviewed sheet into contacts.
export const contactImportsApi = {
  list: async (workspaceId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contact-imports', { params: { path: { workspaceId } } })).data,
  preview: async (workspaceId: string, body: S['CreateContactImportInput']) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contact-imports', { params: { path: { workspaceId } }, body })).data,
  get: async (workspaceId: string, importId: string) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contact-imports/{importId}', { params: { path: { workspaceId, importId } } })).data,
  remap: async (workspaceId: string, importId: string, body: S['UpdateContactImportInput']) => unwrap(await getApiClient().PATCH('/workspaces/{workspaceId}/contact-imports/{importId}', { params: { path: { workspaceId, importId } }, body })).data,
  cancel: async (workspaceId: string, importId: string) => unwrap(await getApiClient().DELETE('/workspaces/{workspaceId}/contact-imports/{importId}', { params: { path: { workspaceId, importId } } })).data,
  rows: async (workspaceId: string, importId: string, query?: operations['listContactImportRows']['parameters']['query']) => unwrap(await getApiClient().GET('/workspaces/{workspaceId}/contact-imports/{importId}/rows', { params: { path: { workspaceId, importId }, query } })),
  resolve: async (workspaceId: string, importId: string, rowId: string, body: S['ResolveContactImportRowInput']) => unwrap(await getApiClient().PUT('/workspaces/{workspaceId}/contact-imports/{importId}/rows/{rowId}/resolution', { params: { path: { workspaceId, importId, rowId } }, body })).data,
  commit: async (workspaceId: string, importId: string, body: S['CommitContactImportInput'] = {}) => unwrap(await getApiClient().POST('/workspaces/{workspaceId}/contact-imports/{importId}/commit', { params: { path: { workspaceId, importId } }, body })).data,
}
