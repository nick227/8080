// Same-workspace rule (doc/09 §1, D13): single-column FKs can't stop a row in one
// workspace pointing at a row in another, so services only load related rows
// with `workspaceId` in the where-clause, and this check proves it held. Run by
// the invariant test; each domain adds its pairs here when it lands.
import { db } from '@project/db'

const CHECKS: { name: string; sql: string }[] = [
  // Conversations listed under a company (redesign D3)
  { name: 'WorkspaceRoom.linkedBy', sql: 'SELECT r.id FROM WorkspaceRoom r JOIN WorkspaceMember m ON m.id = r.linkedByMemberId WHERE m.workspaceId <> r.workspaceId' },
  // Chatbot host + company profile (doc/12)
  { name: 'WorkflowRun.member', sql: 'SELECT r.id FROM WorkflowRun r JOIN WorkspaceMember m ON m.id = r.memberId WHERE m.workspaceId <> r.workspaceId' },
  { name: 'CompanyFact.setBy', sql: 'SELECT f.id FROM CompanyFact f JOIN WorkspaceMember m ON m.id = f.setByMemberId WHERE m.workspaceId <> f.workspaceId' },
  { name: 'CompanyScalarSource.setBy', sql: "SELECT CONCAT(s.workspaceId, ':', s.field) AS id FROM CompanyScalarSource s JOIN WorkspaceMember m ON m.id = s.setByMemberId WHERE m.workspaceId <> s.workspaceId" },
  {
    name: 'TeamMember.team',
    sql: 'SELECT tm.id FROM TeamMember tm JOIN Team t ON t.id = tm.teamId WHERE t.workspaceId <> tm.workspaceId',
  },
  {
    name: 'TeamMember.member',
    sql: 'SELECT tm.id FROM TeamMember tm JOIN WorkspaceMember m ON m.id = tm.memberId WHERE m.workspaceId <> tm.workspaceId',
  },
  {
    name: 'WorkspaceInvite.invitedBy',
    sql: 'SELECT i.id FROM WorkspaceInvite i JOIN WorkspaceMember m ON m.id = i.invitedById WHERE m.workspaceId <> i.workspaceId',
  },
  {
    name: 'ActionExecution.actorMember',
    sql: 'SELECT a.id FROM ActionExecution a JOIN WorkspaceMember m ON m.id = a.actorMemberId WHERE m.workspaceId <> a.workspaceId',
  },
  {
    name: 'Activity.actorMember',
    sql: 'SELECT a.id FROM Activity a JOIN WorkspaceMember m ON m.id = a.actorMemberId WHERE m.workspaceId <> a.workspaceId',
  },
  {
    name: 'Activity.actionExecution',
    sql: 'SELECT a.id FROM Activity a JOIN ActionExecution e ON e.id = a.actionExecutionId WHERE e.workspaceId <> a.workspaceId',
  },
  {
    name: 'ActivitySubject.activity',
    sql: 'SELECT s.id FROM ActivitySubject s JOIN Activity a ON a.id = s.activityId WHERE a.workspaceId <> s.workspaceId',
  },
  // Contacts, notes and links (slice 1)
  {
    name: 'ActivitySubject.contact',
    sql: "SELECT c.id AS id FROM ActivitySubject c JOIN Contact p ON p.id = c.contactId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ActivitySubject.account',
    sql: "SELECT c.id AS id FROM ActivitySubject c JOIN Account p ON p.id = c.accountId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ActivitySubject.inventory',
    sql: "SELECT c.id AS id FROM ActivitySubject c JOIN Inventory p ON p.id = c.inventoryId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Activity.note',
    sql: "SELECT c.id AS id FROM Activity c JOIN Note p ON p.id = c.noteId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Contact.ownerMember',
    sql: "SELECT c.id AS id FROM Contact c JOIN WorkspaceMember p ON p.id = c.ownerMemberId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Contact.team',
    sql: "SELECT c.id AS id FROM Contact c JOIN Team p ON p.id = c.teamId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Contact.createdBy',
    sql: "SELECT c.id AS id FROM Contact c JOIN WorkspaceMember p ON p.id = c.createdById WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Contact.mergedInto',
    sql: "SELECT c.id AS id FROM Contact c JOIN Contact p ON p.id = c.mergedIntoId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ContactPoint.contact',
    sql: "SELECT c.id AS id FROM ContactPoint c JOIN Contact p ON p.id = c.contactId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Account.ownerMember',
    sql: "SELECT c.id AS id FROM Account c JOIN WorkspaceMember p ON p.id = c.ownerMemberId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Account.team',
    sql: "SELECT c.id AS id FROM Account c JOIN Team p ON p.id = c.teamId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Account.createdBy',
    sql: "SELECT c.id AS id FROM Account c JOIN WorkspaceMember p ON p.id = c.createdById WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Account.parentAccount',
    sql: "SELECT c.id AS id FROM Account c JOIN Account p ON p.id = c.parentAccountId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ContactAccount.contact',
    sql: "SELECT c.id AS id FROM ContactAccount c JOIN Contact p ON p.id = c.contactId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ContactAccount.account',
    sql: "SELECT c.id AS id FROM ContactAccount c JOIN Account p ON p.id = c.accountId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ContactTag.tag',
    sql: "SELECT CONCAT(c.tagId, ':', c.contactId) AS id FROM ContactTag c JOIN Tag p ON p.id = c.tagId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'ContactTag.contact',
    sql: "SELECT CONCAT(c.tagId, ':', c.contactId) AS id FROM ContactTag c JOIN Contact p ON p.id = c.contactId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'AccountTag.tag',
    sql: "SELECT CONCAT(c.tagId, ':', c.accountId) AS id FROM AccountTag c JOIN Tag p ON p.id = c.tagId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'AccountTag.account',
    sql: "SELECT CONCAT(c.tagId, ':', c.accountId) AS id FROM AccountTag c JOIN Account p ON p.id = c.accountId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'Note.authorMember',
    sql: "SELECT c.id AS id FROM Note c JOIN WorkspaceMember p ON p.id = c.authorMemberId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'RecordLink.contact',
    sql: "SELECT c.id AS id FROM RecordLink c JOIN Contact p ON p.id = c.contactId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'RecordLink.account',
    sql: "SELECT c.id AS id FROM RecordLink c JOIN Account p ON p.id = c.accountId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'RecordLink.inventory',
    sql: "SELECT c.id AS id FROM RecordLink c JOIN Inventory p ON p.id = c.inventoryId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'RecordLink.note',
    sql: "SELECT c.id AS id FROM RecordLink c JOIN Note p ON p.id = c.noteId WHERE p.workspaceId <> c.workspaceId",
  },
  {
    name: 'RecordLink.linkedBy',
    sql: "SELECT c.id AS id FROM RecordLink c JOIN WorkspaceMember p ON p.id = c.linkedById WHERE p.workspaceId <> c.workspaceId",
  },
  { name: 'Document.ownerMemberId', sql: 'SELECT c.id FROM Document c JOIN WorkspaceMember p ON p.id = c.ownerMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'DocumentGrant.documentId', sql: 'SELECT c.id FROM DocumentGrant c JOIN Document p ON p.id = c.documentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'DocumentGrant.memberId', sql: 'SELECT c.id FROM DocumentGrant c JOIN WorkspaceMember p ON p.id = c.memberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'DocumentRoomLink.documentId', sql: 'SELECT c.id FROM DocumentRoomLink c JOIN Document p ON p.id = c.documentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'DocumentRelation.fromId', sql: 'SELECT c.id FROM DocumentRelation c JOIN Document p ON p.id = c.fromId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'DocumentRelation.toId', sql: 'SELECT c.id FROM DocumentRelation c JOIN Document p ON p.id = c.toId WHERE c.workspaceId <> p.workspaceId' },
  // Canonical imports (doc/10)
  { name: 'ImportBatch.createdBy', sql: 'SELECT c.id FROM ImportBatch c JOIN WorkspaceMember p ON p.id = c.createdById WHERE c.workspaceId <> p.workspaceId' },
  { name: 'ImportBatch.sourceDocument', sql: 'SELECT c.id FROM ImportBatch c JOIN Document p ON p.id = c.sourceDocumentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'ImportBatch.resultDocument', sql: 'SELECT c.id FROM ImportBatch c JOIN Document p ON p.id = c.resultDocumentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'ImportRow.batch', sql: 'SELECT c.id FROM ImportRow c JOIN ImportBatch p ON p.id = c.batchId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'ImportRow.contact', sql: 'SELECT c.id FROM ImportRow c JOIN Contact p ON p.id = c.contactId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Contact.importBatch', sql: 'SELECT c.id FROM Contact c JOIN ImportBatch p ON p.id = c.importBatchId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Inventory.importBatch', sql: 'SELECT c.id FROM Inventory c JOIN ImportBatch p ON p.id = c.importBatchId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'ImportRow.inventory', sql: 'SELECT c.id FROM ImportRow c JOIN Inventory p ON p.id = c.inventoryId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'InventoryStockMovement.inventory', sql: 'SELECT c.id FROM InventoryStockMovement c JOIN Inventory p ON p.id = c.inventoryId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'InventoryStockMovement.actor', sql: 'SELECT c.id FROM InventoryStockMovement c JOIN WorkspaceMember p ON p.id = c.actorMemberId WHERE c.workspaceId <> p.workspaceId' },
  {
    name: 'RecordImage.contact',
    sql: "SELECT c.id FROM RecordImage c JOIN Contact p ON p.id = c.subjectId WHERE c.subjectType = 'contact' AND c.workspaceId <> p.workspaceId",
  },
  {
    name: 'RecordImage.inventory',
    sql: "SELECT c.id FROM RecordImage c JOIN Inventory p ON p.id = c.subjectId WHERE c.subjectType = 'inventory' AND c.workspaceId <> p.workspaceId",
  },
  {
    name: 'RecordImage.company',
    sql: "SELECT c.id FROM RecordImage c WHERE c.subjectType = 'company' AND c.subjectId <> c.workspaceId",
  },
  {
    name: 'InventoryCategory.workspace',
    sql: 'SELECT c.id FROM InventoryCategory c LEFT JOIN Workspace p ON p.id = c.workspaceId WHERE p.id IS NULL',
  },
  { name: 'InboxItem.member', sql: 'SELECT c.id FROM InboxItem c JOIN WorkspaceMember p ON p.id = c.memberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Compose.author', sql: 'SELECT c.id FROM Compose c JOIN WorkspaceMember p ON p.id = c.authorMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Compose.contact', sql: 'SELECT c.id FROM Compose c JOIN Contact p ON p.id = c.contactId WHERE c.workspaceId <> p.workspaceId' },
  // Communication agents (docs/agents)
  { name: 'EmailConnection.createdBy', sql: 'SELECT c.id FROM EmailConnection c JOIN WorkspaceMember p ON p.id = c.createdByMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Agent.emailConnection', sql: 'SELECT c.id FROM Agent c JOIN EmailConnection p ON p.id = c.emailConnectionId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Agent.createdBy', sql: 'SELECT c.id FROM Agent c JOIN WorkspaceMember p ON p.id = c.createdByMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentMessage.agent', sql: 'SELECT c.id FROM AgentMessage c JOIN Agent p ON p.id = c.agentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEvent.agent', sql: 'SELECT c.id FROM AgentEvent c JOIN Agent p ON p.id = c.agentId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEvent.message', sql: 'SELECT c.id FROM AgentEvent c JOIN AgentMessage p ON p.id = c.messageId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEventDelivery.event', sql: 'SELECT c.id FROM AgentEventDelivery c JOIN AgentEvent p ON p.id = c.eventId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEventTarget.delivery', sql: 'SELECT c.id FROM AgentEventTarget c JOIN AgentEventDelivery p ON p.id = c.deliveryId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEventTarget.contact', sql: 'SELECT c.id FROM AgentEventTarget c JOIN Contact p ON p.id = c.contactId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'AgentEventTarget.member', sql: 'SELECT c.id FROM AgentEventTarget c JOIN WorkspaceMember p ON p.id = c.memberId WHERE c.workspaceId <> p.workspaceId' },
  // Calendar / Boards tasks
  { name: 'WorkTask.assignee', sql: 'SELECT c.id FROM WorkTask c JOIN WorkspaceMember p ON p.id = c.assigneeMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkTask.createdBy', sql: 'SELECT c.id FROM WorkTask c JOIN WorkspaceMember p ON p.id = c.createdByMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkTask.blockedBy', sql: 'SELECT c.id FROM WorkTask c JOIN WorkspaceMember p ON p.id = c.blockedByMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'Activity.task', sql: 'SELECT c.id FROM Activity c JOIN WorkTask p ON p.id = c.taskId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'InboxItem.task', sql: "SELECT c.id FROM InboxItem c JOIN WorkTask p ON p.id = c.sourceId WHERE c.sourceType = 'task' AND c.workspaceId <> p.workspaceId" },
  { name: 'WorkTask.parent', sql: 'SELECT c.id FROM WorkTask c JOIN WorkTask p ON p.id = c.parentTaskId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkChecklistItem.task', sql: 'SELECT c.id FROM WorkChecklistItem c JOIN WorkTask p ON p.id = c.taskId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'TaskLink.task', sql: 'SELECT l.id FROM TaskLink l JOIN WorkTask p ON p.id = l.taskId WHERE l.workspaceId <> p.workspaceId' },
  { name: 'TaskLink.contact', sql: 'SELECT l.id FROM TaskLink l JOIN Contact p ON p.id = l.contactId WHERE l.workspaceId <> p.workspaceId' },
  { name: 'TaskLink.linkedBy', sql: 'SELECT l.id FROM TaskLink l JOIN WorkspaceMember p ON p.id = l.linkedById WHERE l.workspaceId <> p.workspaceId' },
  { name: 'TaskView.member', sql: 'SELECT v.id FROM TaskView v JOIN WorkspaceMember p ON p.id = v.memberId WHERE v.workspaceId <> p.workspaceId' },
  { name: 'WorkChecklistItem.doneBy', sql: 'SELECT c.id FROM WorkChecklistItem c JOIN WorkspaceMember p ON p.id = c.doneByMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkLog.member', sql: 'SELECT c.id FROM WorkLog c JOIN WorkspaceMember p ON p.id = c.memberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkLog.author', sql: 'SELECT c.id FROM WorkLog c JOIN WorkspaceMember p ON p.id = c.authorMemberId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkLog.task', sql: 'SELECT c.id FROM WorkLog c JOIN WorkTask p ON p.id = c.taskId WHERE c.workspaceId <> p.workspaceId' },
  { name: 'WorkComment.author', sql: 'SELECT c.id FROM WorkComment c JOIN WorkTask t ON t.id = c.taskId JOIN WorkspaceMember p ON p.id = c.authorMemberId WHERE t.workspaceId <> p.workspaceId' },
]

/** Rows whose references cross a workspace boundary, by check name. Empty = sound. */
export async function crossWorkspaceViolations() {
  const found: Record<string, string[]> = {}
  for (const check of CHECKS) {
    const rows = await db.$queryRawUnsafe<{ id: string }[]>(check.sql)
    if (rows.length) found[check.name] = rows.map((r) => r.id)
  }
  return found
}
