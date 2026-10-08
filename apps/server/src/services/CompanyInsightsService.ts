// Deterministic workspace dashboard aggregates for the Company desk. No AI math.
import { db } from '@project/db'
import { authorize } from './workspacePolicy'
import { ensurePipelineStages } from './PipelineService'
import { CompanyProfileService } from './CompanyProfileService'

export type InsightLink = { desk: string; params?: Record<string, string> }
export type InsightCard = { id: string; label: string; value: string; href: InsightLink }
export type AttentionRow = { id: string; label: string; detail: string; href: InsightLink }
export type StageCount = { key: string; label: string; count: number; kind: string; href: InsightLink }
export type ActivityRow = { id: string; title: string; summary: string; at: string; href: InsightLink | null }

const profiles = new CompanyProfileService()

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

export class CompanyInsightsService {
  async get(userId: string, workspaceId: string) {
    const actor = await authorize(userId, workspaceId, 'companyProfile.read')
    await ensurePipelineStages(db, workspaceId)
    const currency = actor.workspace.defaultCurrency || 'USD'
    const tz = actor.workspace.timezone
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const startOfLocalDay = (() => {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
      return new Date(`${key}T00:00:00Z`)
    })()

    const stages = await db.pipelineStage.findMany({
      where: { workspaceId, archived: false },
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
    })
    const openKeys = stages.filter((s) => s.kind === 'open').map((s) => s.key)
    const wonKeys = stages.filter((s) => s.kind === 'won').map((s) => s.key)

    const active = { workspaceId, deletedAt: null as Date | null, status: 'active' as const }

    const [
      openLeads,
      customers,
      newWeek,
      overdue,
      pipelineValue,
      stageGroups,
      lowStock,
      activeSkus,
      stockRows,
      profile,
      activity,
    ] = await Promise.all([
      openKeys.length ? db.contact.count({ where: { ...active, leadStatus: { in: openKeys } } }) : 0,
      wonKeys.length ? db.contact.count({ where: { ...active, leadStatus: { in: wonKeys } } }) : 0,
      db.contact.count({ where: { ...active, createdAt: { gte: weekAgo } } }),
      openKeys.length
        ? db.contact.count({ where: { ...active, leadStatus: { in: openKeys }, won: false, nextFollowUp: { lt: startOfLocalDay } } })
        : 0,
      openKeys.length
        ? db.contact.aggregate({
            where: { ...active, leadStatus: { in: openKeys }, potentialValue: { not: null } },
            _sum: { potentialValue: true },
          })
        : Promise.resolve({ _sum: { potentialValue: null } }),
      db.contact.groupBy({
        by: ['leadStatus'],
        where: active,
        _count: { _all: true },
      }),
      db.inventory.count({ where: { workspaceId, status: 'active', lowStock: true } }),
      db.inventory.count({ where: { workspaceId, status: 'active' } }),
      db.inventory.findMany({
        where: { workspaceId, status: 'active', quantity: { not: null } },
        select: { priceMinor: true, quantity: true },
      }),
      profiles.get(userId, workspaceId),
      db.activityEvent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ])

    const valueSum = Number(pipelineValue._sum.potentialValue ?? 0)
    const catalogMinor = stockRows.reduce((n, r) => n + r.priceMinor * (r.quantity ?? 0), 0)

    const listKinds = new Set(profile.facts.map((f) => f.kind))
    const filled =
      [profile.name, profile.location, profile.purpose].filter(Boolean).length +
      (listKinds.has('offering') ? 1 : 0) +
      (listKinds.has('customer') ? 1 : 0)
    const completeness = Math.round((filled / 5) * 100)

    const countByStage = new Map(stageGroups.map((g) => [g.leadStatus ?? '', g._count._all]))
    const pipeline: StageCount[] = stages.map((s) => ({
      key: s.key,
      label: s.label,
      count: countByStage.get(s.key) ?? 0,
      kind: s.kind,
      href: { desk: 'contacts', params: { stage: s.key } },
    }))

    const cards: InsightCard[] = [
      { id: 'open-leads', label: 'Open leads', value: String(openLeads), href: { desk: 'contacts', params: { focus: 'due' } } },
      { id: 'pipeline-value', label: 'Pipeline value', value: money(valueSum, currency), href: { desk: 'contacts' } },
      { id: 'overdue', label: 'Overdue follow-ups', value: String(overdue), href: { desk: 'contacts', params: { focus: 'overdue' } } },
      { id: 'low-stock', label: 'Low stock', value: String(lowStock), href: { desk: 'inventory', params: { stock: 'low' } } },
      { id: 'customers', label: 'Customers', value: `${customers} · ${newWeek} new / 7d`, href: { desk: 'contacts', params: { stage: wonKeys[0] ?? 'customer' } } },
      { id: 'catalog', label: 'Active catalog', value: `${activeSkus} · ${money(catalogMinor / 100, currency)}`, href: { desk: 'inventory' } },
    ]

    const attention: AttentionRow[] = []
    if (completeness < 100) {
      attention.push({
        id: 'profile-gap',
        label: 'Company profile incomplete',
        detail: `${completeness}% of required facts filled`,
        href: { desk: 'company' },
      })
    }
    if (overdue > 0) {
      attention.push({
        id: 'overdue-followups',
        label: `${overdue} overdue follow-up${overdue === 1 ? '' : 's'}`,
        detail: 'Open pipeline contacts past their follow-up date',
        href: { desk: 'contacts', params: { focus: 'overdue' } },
      })
    }
    if (lowStock > 0) {
      attention.push({
        id: 'low-stock-attn',
        label: `${lowStock} low-stock item${lowStock === 1 ? '' : 's'}`,
        detail: 'At or under their low-stock level',
        href: { desk: 'inventory', params: { stock: 'low' } },
      })
    }

    const recent: ActivityRow[] = activity.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      at: a.createdAt.toISOString(),
      href: activityHref(a.sourceType, a.sourceId),
    }))

    return { cards, attention, pipeline, recent, profileCompleteness: completeness }
  }
}

function activityHref(sourceType: string | null, sourceId: string | null): InsightLink | null {
  if (!sourceType || !sourceId) return null
  if (sourceType === 'contact') return { desk: 'contacts', params: { record: sourceId } }
  if (sourceType === 'inventory') return { desk: 'inventory', params: { record: sourceId } }
  if (sourceType === 'document') return { desk: 'documents' }
  return null
}

export const companyInsightsService = new CompanyInsightsService()
