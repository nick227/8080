import { db } from '@project/db'
import { afterAll, afterEach, beforeAll } from 'vitest'

// One shared test DB — serialize concurrent vitest processes (another suite wiping
// mid-seed shows up as botId/userId FK errors and SSE timeouts).
const TEST_LOCK = 'voice_chat_test'
beforeAll(async () => {
  // MySQL 8 returns GET_LOCK as BIGINT (1n), MariaDB as a number: compare as a number.
  const rows = await db.$queryRawUnsafe<Array<{ ok: number | bigint | null }>>(`SELECT GET_LOCK(?, 180) AS ok`, TEST_LOCK)
  if (Number(rows[0]?.ok) !== 1) throw new Error('could not acquire test database lock (is another vitest using TEST_DATABASE_URL?)')
})
afterAll(async () => {
  await db.$queryRawUnsafe(`SELECT RELEASE_LOCK(?)`, TEST_LOCK)
  // A lock belongs to one connection and the release may run on another pooled one;
  // closing the client frees it either way, so the next file never waits on it.
  await db.$disconnect()
})

// Clean between tests — children before parents for FK constraints.
afterEach(async () => {
  // Workspaces (doc/09) before users: Workspace.createdBy restricts user deletes.
  // Chatbot host + company profile (doc/12), proposals (doc/13): before members.
  await db.agentBusinessEvent.deleteMany()
  await db.agentEmailSuppression.deleteMany()
  await db.agentUnsubscribeToken.deleteMany()
  await db.agentProposal.deleteMany()
  await db.contactBrief.deleteMany()
  await db.companyProfileRevision.deleteMany()
  await db.companyFact.deleteMany()
  await db.companyScalarSource.deleteMany()
  await db.companyProfile.deleteMany()
  await db.workflowAnswer.deleteMany()
  await db.workflowRun.deleteMany()
  await db.assistantCall.deleteMany()
  await db.activityEvent.deleteMany()
  await db.inboxItem.deleteMany()
  await db.compose.deleteMany()
  await db.workspaceRoom.deleteMany()
  await db.workspaceChannel.deleteMany()
  await db.documentRelation.deleteMany()
  await db.documentRoomLink.deleteMany()
  await db.documentGrant.deleteMany()
  await db.documentContent.deleteMany()
  await db.document.deleteMany()
  await db.activitySubject.deleteMany()
  await db.activity.deleteMany()
  await db.actionExecution.deleteMany()
  await db.recordLink.deleteMany()
  await db.note.deleteMany()
  await db.recordImage.deleteMany()
  await db.interest.deleteMany()
  await db.inventoryStockMovement.deleteMany()
  await db.inventoryCategory.deleteMany()
  await db.inventory.deleteMany()
  await db.importRow.deleteMany()
  await db.importBatch.deleteMany()
  await db.contactTag.deleteMany()
  await db.accountTag.deleteMany()
  await db.tag.deleteMany()
  await db.contactAccount.deleteMany()
  await db.contactPoint.deleteMany()
  await db.contact.updateMany({ data: { mergedIntoId: null } })
  await db.contact.deleteMany()
  await db.account.updateMany({ data: { parentAccountId: null } })
  await db.account.deleteMany()
  await db.contactFieldDefinition.deleteMany()
  await db.pipelineStage.deleteMany()
  await db.teamMember.deleteMany()
  await db.team.deleteMany()
  await db.workspaceInvite.deleteMany()
  await db.workspaceMember.deleteMany()
  // Agents (docs/agents) cascade from Workspace; the dev outbox has no FK.
  await db.devOutboxEmail.deleteMany()
  await db.workspace.deleteMany()
  await db.botDecision.deleteMany()
  await db.botRoute.deleteMany()
  await db.botOnce.deleteMany()
  await db.roomBot.deleteMany()
  await db.botLine.deleteMany()
  await db.botAsset.deleteMany()
  await db.bot.deleteMany()
  await db.userMute.deleteMany()
  await db.reaction.deleteMany()
  await db.media.deleteMany()
  await db.item.updateMany({ data: { parentId: null } }) // self-FK: unlink before delete
  await db.item.deleteMany()
  await db.message.deleteMany() // after items (FK) and media (SetNull)
  await db.roomChange.deleteMany()
  await db.roomMember.deleteMany()
  await db.room.deleteMany()
  await db.session.deleteMany()
  await db.profile.deleteMany()
  await db.user.deleteMany()
})
