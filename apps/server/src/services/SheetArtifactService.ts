// Sheets made from records (doc/13 §12, A1): a preset or a validated query → a native
// grid document whose rows are stored on the server (everyone with access sees the
// same rows). The provenance is the recipe: the resolved query, when it ran and a
// hash of what it read. That makes "the data changed since" a re-run and a compare,
// and Regenerate a new document beside the old one — never a silent overwrite.
import type { Prisma } from '@project/db'
import type { SheetQuery, SheetRecipe } from '@project/shared'
import { badRequest, notFound } from '../lib/errors'
import { authorize, permit } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { DocumentService } from './DocumentService'
import { runAction } from './actions'
import { SHEET_PRESETS, describeSheetQuery, presetFor, runSheetQuery, shortDay, todayIn, validateSheetQuery, type SheetContext } from './sheetQuery'

const documents = new DocumentService()
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue

export type SheetRequest = {
  preset?: string
  query?: SheetQuery
  title?: string
  idempotencyKey: string
  /** Server-internal: who else in the workspace sees it (the channel's sheets are shared). */
  workspaceAccess?: 'viewer' | 'editor' | null
  /** Server-internal: the document this one regenerates. */
  previousId?: string | null
  /** Server-internal: refuse instead of making a sheet with no rows (the channel says so). */
  refuseEmpty?: boolean
}

export const isSheetRecipe = (p: unknown): p is SheetRecipe =>
  !!p && typeof p === 'object' && (p as SheetRecipe).kind === 'artifact' && (p as SheetRecipe).generator === 'sheet.query'

async function readerOf(userId: string, workspaceId: string) {
  const actor = await authorize(userId, workspaceId, 'record.read')
  permit(actor, 'dataset.read')
  return { actor, ctx: { workspaceId, timezone: actor.workspace.timezone, currency: actor.workspace.defaultCurrency } satisfies SheetContext }
}

/** A preset or a query → the resolved query and its default title. */
export function resolveSheet(input: { preset?: string; query?: unknown; title?: string }, timezone: string, now = new Date()) {
  if (!!input.preset === (input.query !== undefined)) throw badRequest('Give a preset or a query', 'INVALID_SHEET_REQUEST')
  const today = todayIn(timezone, now)
  if (input.preset) {
    const preset = presetFor(input.preset)
    if (!preset) throw badRequest('Unknown sheet preset', 'UNKNOWN_SHEET_PRESET')
    return { preset: preset.key, query: validateSheetQuery(preset.build(today)), title: input.title?.trim() || `${preset.label} · ${shortDay(today)}` }
  }
  const query = validateSheetQuery(input.query)
  return { preset: null, query, title: input.title?.trim() || `${query.source === 'contacts' ? 'Contacts' : 'Inventory'} · ${shortDay(today)}` }
}

export class SheetArtifactService {
  async presets(userId: string, workspaceId: string) {
    await readerOf(userId, workspaceId)
    return SHEET_PRESETS.map(({ key, label, description }) => ({ key, label, description }))
  }

  /** Plain words for a query, before it runs. */
  async describe(userId: string, workspaceId: string, query: unknown) {
    const { ctx } = await readerOf(userId, workspaceId)
    return describeSheetQuery(ctx, validateSheetQuery(query))
  }

  async create(wctx: WorkspaceCtx, workspaceId: string, input: SheetRequest) {
    const { actor, ctx } = await readerOf(wctx.user.id, workspaceId)
    permit(actor, 'document.create'); permit(actor, 'dataset.export')
    const resolved = resolveSheet(input, ctx.timezone)
    if (resolved.title.length > 200) throw badRequest('Title must contain 1–200 characters', 'INVALID_TITLE')
    const summary = await describeSheetQuery(ctx, resolved.query)
    const documentId = await runAction({
      action: 'document.sheet.create', workspaceId, actor: memberActor(actor), origin: wctx.origin, target: { type: 'document' },
      input: { preset: resolved.preset, query: resolved.query, title: resolved.title, previousId: input.previousId ?? null }, idempotencyKey: input.idempotencyKey,
    }, async (tx) => {
      const result = await runSheetQuery(ctx, resolved.query)
      if (input.refuseEmpty && result.rowCount === 0) throw badRequest(resolved.query.source === 'contacts' ? 'No contacts match that right now, so I made no sheet' : 'No inventory items match that right now, so I made no sheet', 'SHEET_EMPTY')
      const recipe: SheetRecipe = {
        kind: 'artifact', generator: 'sheet.query', generatorVersion: 1, preset: resolved.preset, query: resolved.query, summary,
        asOf: result.asOf, timezone: ctx.timezone, currency: ctx.currency, rowCount: result.rowCount, dataHash: result.dataHash, previousId: input.previousId ?? null,
      }
      const row = await tx.document.create({
        data: {
          workspaceId, ownerMemberId: actor.member.id, title: resolved.title, surface: 'grid', sourceKind: 'native',
          descriptor: { surface: 'grid', source: { kind: 'native', schemaVersion: 1 } }, payload: json(result.table), provenance: json(recipe),
          // Reading it needs the same record access as running it.
          protectedDataset: resolved.query.source,
          ...(input.workspaceAccess ? { workspaceAccess: input.workspaceAccess } : {}),
        },
      })
      // The typed sheet people edit (version 1); the snapshot above stays the recipe's baseline.
      await tx.documentContent.create({ data: { documentId: row.id, workspaceId, version: 1, content: json(result.content), updatedByMemberId: actor.member.id } })
      if (input.previousId) {
        const [fromId, toId] = [input.previousId, row.id].sort() as [string, string]
        await tx.documentRelation.create({ data: { workspaceId, fromId, toId } })
      }
      return { value: row.id, targetId: row.id }
    }, async (previous) => previous.targetId!)
    return documents.get(wctx.user.id, workspaceId, documentId)
  }

  /** The recipe and whether the same query now reads different rows. */
  async recipe(userId: string, workspaceId: string, documentId: string) {
    const { row } = await documents.access(userId, workspaceId, documentId)
    const recipe = row.provenance
    // A budget is made from the person's inputs, not records: nothing to re-run.
    if ((recipe as { generator?: string } | null)?.generator === 'budget.monthly') return { recipe, stale: false, dataChanged: false, periodMoved: false, currentRowCount: null, checkedAt: new Date().toISOString() }
    if (!isSheetRecipe(recipe)) throw notFound('This document was not made from a sheet query')
    const { ctx } = await readerOf(userId, workspaceId)
    const now = new Date()
    let stale: boolean
    let currentRowCount: number | null = null
    try {
      const current = await runSheetQuery({ ...ctx, timezone: recipe.timezone, currency: recipe.currency }, validateSheetQuery(recipe.query), now)
      stale = current.dataHash !== recipe.dataHash
      currentRowCount = current.rowCount
    } catch (error) {
      // Grown past the sheet limit: certainly changed, but it can't be re-run as is.
      if ((error as { code?: string }).code !== 'SHEET_TOO_LARGE') throw error
      stale = true
    }
    // A preset's relative dates (e.g. "this week") move on with the calendar.
    const presetMoved = !!recipe.preset && JSON.stringify(resolveSheet({ preset: recipe.preset }, recipe.timezone, now).query) !== JSON.stringify(recipe.query)
    return { recipe, stale: stale || presetMoved, dataChanged: stale, periodMoved: presetMoved, currentRowCount, checkedAt: now.toISOString() }
  }

  /** A new document from the same recipe, related to the old one; the old one stays. */
  async regenerate(wctx: WorkspaceCtx, workspaceId: string, documentId: string, idempotencyKey: string) {
    const { row } = await documents.access(wctx.user.id, workspaceId, documentId)
    const recipe = row.provenance
    if (!isSheetRecipe(recipe)) throw notFound('This document was not made from a sheet query')
    const base = row.title.replace(/ · [A-Z][a-z]{2} \d{1,2}$/, '')
    const title = recipe.preset ? undefined : base
    return this.create(wctx, workspaceId, {
      ...(recipe.preset ? { preset: recipe.preset } : { query: recipe.query }), ...(title ? { title: `${title} · ${shortDay(todayIn(recipe.timezone))}` } : {}),
      idempotencyKey, workspaceAccess: row.workspaceAccess, previousId: row.id,
    })
  }
}

export const sheetArtifacts = new SheetArtifactService()
