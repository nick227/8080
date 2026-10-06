// Registered proposal kinds (doc/13 §5). Each is the only code that knows how to
// validate, show, apply and undo its change. New kinds (contact status, follow-up,
// inventory…) are added here as their slices land.
import { badRequest } from '../lib/errors'
import { CompanyProfileService, LISTS, isList, type FieldSnapshot, type Scalar } from './CompanyProfileService'
import { registerProposalKind, type ProposalHandler } from '../lib/proposal'
import { db } from '@project/db'
import { normalizePoint } from './contactMatch'
import { ground } from '../bots/assistant/grounding'
import { applyPlan, describePlan, editPlan, planNote, undoPlan, type NotePlan, type NoteUndo } from './crmNote'

export const COMPANY_PROFILE_FACT = 'company-profile.fact'

type Field = Scalar | keyof typeof LISTS
export type FactChange = { field: Field; value: string | string[] | null }

export const FIELD_LABELS: Record<Field, string> = {
  name: 'Name', location: 'Location', serviceArea: 'Where it works', purpose: 'What it does', brandVoice: 'Voice',
  offerings: 'Offerings', customers: 'Customers', differentiators: 'What makes it different',
}
const AREAS = ['local', 'regional', 'national', 'global']
const VOICES = ['professional', 'friendly', 'bold', 'technical']
const MAX: Partial<Record<Field, number>> = { name: 200, location: 200, purpose: 1000 }

const profiles = new CompanyProfileService()
const show = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '')

const companyProfileFact: ProposalHandler<FactChange> = {
  targetType: 'companyProfile',
  readVerb: 'companyProfile.read',
  applyVerb: 'companyProfile.edit',

  validate(raw) {
    const r = raw as Partial<FactChange> | null
    const field = r?.field as Field
    if (!field || !(field in FIELD_LABELS)) throw badRequest('Unknown company profile field', 'INVALID_FIELD')
    if (isList(field)) {
      if (!Array.isArray(r!.value)) throw badRequest('A list field takes a list of values', 'INVALID_VALUE')
      const values = [...new Set(r!.value.map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')).filter(Boolean))]
      if (values.length > 12 || values.some((v) => v.length > 500)) throw badRequest('Up to 12 values of 500 characters', 'INVALID_VALUE')
      return { field, value: values }
    }
    const value = typeof r!.value === 'string' ? r!.value.trim().replace(/\s+/g, ' ') : null
    if (field === 'serviceArea' && value !== null && !AREAS.includes(value)) throw badRequest(`Where it works is one of ${AREAS.join(', ')}`, 'INVALID_VALUE')
    if (field === 'brandVoice' && value !== null && !VOICES.includes(value)) throw badRequest(`Voice is one of ${VOICES.join(', ')}`, 'INVALID_VALUE')
    if (field === 'name' && !value) throw badRequest('The company needs a name', 'INVALID_VALUE')
    if (value && MAX[field] && value.length > MAX[field]!) throw badRequest(`Keep it under ${MAX[field]} characters`, 'INVALID_VALUE')
    return { field, value }
  },

  // The profile always "exists" for a workspace; its version is the revision.
  async version(workspaceId, targetId) {
    if (targetId !== workspaceId) return null
    return (await profiles.current(workspaceId)).revision
  },

  async describe(workspaceId, _targetId, change) {
    const p = await profiles.current(workspaceId)
    const kind = isList(change.field) ? LISTS[change.field] : null
    const before = kind ? p.facts.filter((f) => f.kind === kind).map((f) => f.value) : (p[change.field as Scalar] as string | null)
    return { title: `Company profile · ${FIELD_LABELS[change.field]}`, diff: [{ label: FIELD_LABELS[change.field], before: show(before), after: show(change.value) }] }
  },

  async apply(ctx, workspaceId, _targetId, change, baseVersion) {
    const { revision, before } = await profiles.setField(ctx, workspaceId, { field: change.field, value: change.value, expectedRevision: baseVersion })
    return { resultVersion: revision, undoData: before }
  },

  async undo(ctx, workspaceId, _targetId, undoData: FieldSnapshot, resultVersion) {
    await profiles.restoreField(ctx, workspaceId, { before: undoData, expectedRevision: resultVersion })
  },

  revert(undoData: FieldSnapshot) {
    return 'facts' in undoData ? { field: undoData.field, value: undoData.facts.map((f) => f.value) } : { field: undoData.field, value: undoData.value }
  },
}

// ─── crm.note (doc/13 §10, D2) ───────────────────────────────────────────────────

export const CRM_NOTE = 'crm.note'
export const NEW_CONTACT = 'new'

const str = (v: unknown, max: number, label: string, nullable = false): string | null => {
  if (v === null && nullable) return null
  if (typeof v !== 'string' || v.length > max || (!nullable && !v.trim())) throw badRequest(`Invalid ${label}`, 'INVALID_PLAN')
  return v
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

// The plan is produced by server code (planNote / editPlan); a client can also post
// one, so every part of its shape is checked again here.
function validatePlan(raw: unknown): NotePlan {
  const p = raw as NotePlan
  if (!p || typeof p !== 'object') throw badRequest('Invalid plan', 'INVALID_PLAN')
  str(p.note, 5000, 'note')
  if ('create' in (p.contact ?? {})) {
    const c = (p.contact as unknown as { create: { firstName: unknown; lastName: unknown; displayName: unknown } }).create ?? {}
    str(c.displayName, 160, 'name'); str(c.firstName, 80, 'first name', true); str(c.lastName, 80, 'last name', true)
  } else { str((p.contact as { id: string })?.id, 64, 'contact'); str((p.contact as { name: string })?.name, 160, 'contact name') }
  if (p.account !== null) {
    if (!p.account || typeof p.account !== 'object') throw badRequest('Invalid company', 'INVALID_PLAN')
    if ('create' in p.account) { str(p.account.create.name, 160, 'company'); str(p.account.create.domain, 255, 'domain', true) }
    else { str(p.account.id, 64, 'company'); if (typeof p.account.link !== 'boolean') throw badRequest('Invalid company', 'INVALID_PLAN') }
  }
  if (!p.set || typeof p.set !== 'object') throw badRequest('Invalid fields', 'INVALID_PLAN')
  if (p.set.title !== undefined) str(p.set.title, 120, 'title')
  if (p.set.nextFollowUp !== undefined && !ISO_DAY.test(String(p.set.nextFollowUp))) throw badRequest('Invalid follow-up', 'INVALID_PLAN')
  if (!Array.isArray(p.addPoints) || p.addPoints.length > 4 || p.addPoints.some((x) => !['email', 'phone'].includes(x?.kind) || !normalizePoint(x.kind, String(x.value ?? '')))) throw badRequest('Invalid email or phone', 'INVALID_PLAN')
  if (!Array.isArray(p.facts) || p.facts.length > 10 || p.facts.some((f) => !['need', 'timing', 'budget', 'other'].includes(f?.key) || typeof f.value !== 'string' || typeof f.quote !== 'string' || f.value.length > 300)) throw badRequest('Invalid facts', 'INVALID_PLAN')
  return { ...p, quotes: p.quotes && typeof p.quotes === 'object' ? p.quotes : {}, reading: p.reading ?? null }
}

const crmNote: ProposalHandler<NotePlan> = {
  targetType: 'contact',
  readVerb: 'record.read',
  applyVerb: 'record.write',
  validate: validatePlan,
  // A new person has no record yet: version 0 until Apply creates it.
  async version(workspaceId, targetId) {
    if (targetId === NEW_CONTACT) return 0
    const c = await db.contact.findFirst({ where: { id: targetId, workspaceId, deletedAt: null }, select: { version: true } })
    return c?.version ?? null
  },
  describe: (workspaceId, _targetId, plan) => describePlan(workspaceId, plan),
  async apply(ctx, workspaceId, _targetId, plan, baseVersion) {
    const done = await applyPlan(ctx, workspaceId, plan, baseVersion)
    return { resultVersion: done.resultVersion, undoData: done.undo, targetId: done.contactId }
  },
  async undo(ctx, workspaceId, _targetId, undoData: NoteUndo, resultVersion) {
    await undoPlan(ctx, workspaceId, undoData, resultVersion)
  },
  edit: (plan, edits) => editPlan(plan, edits),
  // Refresh: match again (the chosen contact is kept); a new ambiguity needs the note flow.
  async replan(workspaceId, plan) {
    const reading = plan.reading ? ground(plan.note, plan.reading, new Date().toISOString().slice(0, 10)) : null
    const chosen = 'id' in plan.contact ? { contactId: plan.contact.id } : {}
    const next = await planNote(workspaceId, plan.note, reading, chosen)
    if ('ambiguous' in next) throw badRequest('This needs a choice again — add the note once more', 'NEEDS_CHOICE')
    return { targetId: 'id' in next.plan.contact ? next.plan.contact.id : NEW_CONTACT, change: next.plan }
  },
}

// Kinds are fixed server code: registered when this module loads (ProposalService
// imports it), not by whichever process happens to start the bots.
registerProposalKind(COMPANY_PROFILE_FACT, companyProfileFact)
registerProposalKind(CRM_NOTE, crmNote)
