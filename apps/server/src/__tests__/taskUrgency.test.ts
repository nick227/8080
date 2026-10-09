// The one definition of "needs attention" shared by Board, Calendar, Table and reports.
import { describe, it, expect } from 'vitest'
import { isUrgent, matchesUrgency, weekEnd, type UrgencyTask } from '@project/shared'

const today = '2026-10-08' // a Thursday
const now = Date.parse('2026-10-08T15:00:00Z')
const ctx = { today, now }
const task = (over: Partial<UrgencyTask> = {}): UrgencyTask => ({ status: 'open', dueDate: null, updatedAt: '2026-10-01T00:00:00Z', blocked: null, ...over })

describe('task urgency', () => {
  it('weeks end on Sunday', () => {
    expect(weekEnd('2026-10-08')).toBe('2026-10-11')
    expect(weekEnd('2026-10-11')).toBe('2026-10-11')
    expect(weekEnd('2026-10-12')).toBe('2026-10-18')
  })

  it('overdue and due this week are separate, and done never counts', () => {
    expect(isUrgent(task({ dueDate: '2026-10-07' }), 'overdue', ctx)).toBe(true)
    expect(isUrgent(task({ dueDate: '2026-10-08' }), 'overdue', ctx)).toBe(false)
    expect(isUrgent(task({ dueDate: '2026-10-08' }), 'due_week', ctx)).toBe(true)
    expect(isUrgent(task({ dueDate: '2026-10-11' }), 'due_week', ctx)).toBe(true)
    expect(isUrgent(task({ dueDate: '2026-10-12' }), 'due_week', ctx)).toBe(false)
    expect(isUrgent(task({ dueDate: '2026-10-07' }), 'due_week', ctx)).toBe(false)
    expect(isUrgent(task({ dueDate: '2026-10-07', status: 'done' }), 'overdue', ctx)).toBe(false)
    expect(isUrgent(task({ blocked: { reason: 'x' }, status: 'done' }), 'blocked', ctx)).toBe(false)
    expect(isUrgent(task({ blocked: { reason: 'x' } }), 'blocked', ctx)).toBe(true)
  })

  it('recently updated means the last 24 hours, done or not', () => {
    expect(isUrgent(task({ updatedAt: '2026-10-07T16:00:00Z', status: 'done' }), 'recent', ctx)).toBe(true)
    expect(isUrgent(task({ updatedAt: new Date('2026-10-07T14:00:00Z') }), 'recent', ctx)).toBe(false)
  })

  it('several chosen = any of them; none chosen = everything', () => {
    const blocked = task({ blocked: { reason: 'x' } })
    const late = task({ dueDate: '2026-10-01' })
    const calm = task()
    expect([blocked, late, calm].filter((t) => matchesUrgency(t, ['blocked', 'overdue'], ctx))).toEqual([blocked, late])
    expect([blocked, late, calm].filter((t) => matchesUrgency(t, [], ctx))).toHaveLength(3)
  })
})
