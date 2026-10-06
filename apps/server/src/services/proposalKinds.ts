// Registered proposal kinds (doc/13 §5). Each is the only code that knows how to
// validate, show, apply and undo its change. New kinds (contact status, follow-up,
// inventory…) are added here as their slices land.
import { badRequest } from '../lib/errors'
import { CompanyProfileService, LISTS, isList, type FieldSnapshot, type Scalar } from './CompanyProfileService'
import { registerProposalKind, type ProposalHandler } from '../lib/proposal'

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

// Kinds are fixed server code: registered when this module loads (ProposalService
// imports it), not by whichever process happens to start the bots.
registerProposalKind(COMPANY_PROFILE_FACT, companyProfileFact)
