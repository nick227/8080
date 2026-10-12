// Due-date reminders: the assignee hears once when a task is due tomorrow and once
// when it turns overdue, from 8 AM workspace time; done tasks never remind.
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, testUserId } from './helpers'
import { caller, carolId, createWorkspace, join, seedPeople } from './helpers/workspace'
import { drainTaskEmails } from '../services/taskEmail'
import { remindDueTasks } from '../services/taskReminders'
import { setPushSender } from '../services/push'

const app = buildTestApp()
const call = caller(app)
afterEach(() => setPushSender(null))

describe('task reminders', () => {
  it('due tomorrow and newly overdue, once each, from 8 AM in the workspace time zone', async () => {
    const ws = await createWorkspace(app, testUserId, { name: 'Acme Co', timezone: 'America/New_York' })
    await seedPeople()
    const carol = await join(app, ws.id, carolId, 'carol@test.local')
    const base = `/workspaces/${ws.id}/tasks`
    const make = async (body: object) => (await call(testUserId, 'POST', base, body)).json().data
    const soon = await make({ title: 'Send the proposal', dueDate: '2026-03-11', assigneeMemberId: carol })
    const late = await make({ title: 'Renew the domain', dueDate: '2026-03-09', assigneeMemberId: carol })
    const finished = await make({ title: 'Already done', dueDate: '2026-03-11', assigneeMemberId: carol })
    await call(testUserId, 'POST', `${base}/${finished.id}/move`, { status: 'done' })
    await make({ title: 'Nobody', dueDate: '2026-03-11' })
    await make({ title: 'Long overdue', dueDate: '2026-03-01', assigneeMemberId: carol }) // told once, on its first overdue day
    const assigned = await db.inboxItem.count({ where: { memberId: carol } })
    const pushed: string[] = []
    setPushSender(async (_target, payload) => { pushed.push(JSON.parse(payload).title) })
    await call(carolId, 'POST', '/push/subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/carol', keys: { p256dh: 'k', auth: 'a' } })

    // 7:30 AM in New York (11:30 UTC): too early.
    expect(await remindDueTasks(new Date('2026-03-10T11:30:00Z'))).toEqual([])
    // 9 AM in New York.
    const sent = await remindDueTasks(new Date('2026-03-10T13:00:00Z'))
    expect(sent.map((r) => r.title).sort()).toEqual([`${late.taskKey} is overdue (was due Mar 9)`, `${soon.taskKey} is due tomorrow`].sort())
    expect(sent.every((r) => r.memberId === carol && r.sourceType === 'task')).toBe(true)
    expect(Object.fromEntries(sent.map((r) => [r.title, r.type]))).toEqual({ [`${late.taskKey} is overdue (was due Mar 9)`]: 'task.overdue', [`${soon.taskKey} is due tomorrow`]: 'task.due' })
    // Only the newly overdue one reaches the phone; due tomorrow waits in the inbox.
    await new Promise((r) => setTimeout(r, 150))
    expect(pushed).toEqual([`${late.taskKey} is overdue (was due Mar 9)`])
    // Once only.
    expect(await remindDueTasks(new Date('2026-03-10T15:00:00Z'))).toEqual([])
    expect(await db.inboxItem.count({ where: { memberId: carol } })).toBe(assigned + 2)

    // Reminders are personal: emailed under the default "mentions and assignments".
    await drainTaskEmails()
    const subjects = (await db.devOutboxEmail.findMany({ where: { to: 'carol@test.local' } })).map((m) => m.subject)
    expect(subjects).toContain(`${soon.taskKey} is due tomorrow`)
    // Off = in-app only.
    await call(carolId, 'PUT', `/workspaces/${ws.id}/task-notifications`, { email: 'off' })
    const next = await remindDueTasks(new Date('2026-03-12T13:00:00Z')) // soon is now overdue
    expect(next.map((r) => r.title)).toEqual([`${soon.taskKey} is overdue (was due Mar 11)`])
    expect((await db.inboxItem.findUniqueOrThrow({ where: { id: next[0]!.id } })).emailStatus).toBeNull()
  })
})
