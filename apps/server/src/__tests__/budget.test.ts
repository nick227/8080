import { describe, expect, it } from 'vitest'
import { buildTestApp, testUserId, validateResponse } from './helpers'
import { caller, createWorkspace } from './helpers/workspace'

const app = buildTestApp()
const call = caller(app)

describe('workspace budget entity and summary calculations', () => {
  it('creates, lists, aggregates, and modifies budget items', async () => {
    const ws = await createWorkspace(app, testUserId, { name: 'Acme Studio' })
    const base = `/workspaces/${ws.id}`

    // 1. Create an income item
    const incomeRes = await call(testUserId, 'POST', `${base}/budget`, {
      title: 'Acme Monthly Retainer',
      direction: 'income',
      category: 'client_retainer',
      amountMinor: 350000, // $3,500.00
      scheduledDate: '2026-10-15',
      status: 'pending',
    })
    expect(incomeRes.statusCode).toBe(201)
    await validateResponse('createBudgetItem', 201, incomeRes.json())
    const incomeItem = incomeRes.json().data
    expect(incomeItem.title).toBe('Acme Monthly Retainer')
    expect(incomeItem.amountMinor).toBe(350000)

    // 2. Create an expense item
    const expenseRes = await call(testUserId, 'POST', `${base}/budget`, {
      title: 'Design Software Cloud',
      direction: 'expense',
      category: 'software_tools',
      amountMinor: 12000, // $120.00
      scheduledDate: '2026-10-16',
      status: 'cleared',
    })
    expect(expenseRes.statusCode).toBe(201)
    const expenseItem = expenseRes.json().data
    expect(expenseItem.direction).toBe('expense')
    expect(expenseItem.amountMinor).toBe(12000)

    // 3. List budget items
    const listRes = await call(testUserId, 'GET', `${base}/budget`)
    expect(listRes.statusCode).toBe(200)
    await validateResponse('listBudgetItems', 200, listRes.json())
    const listData = listRes.json()
    expect(listData.total).toBe(2)
    expect(listData.data.length).toBe(2)

    // 4. Check summary calculation
    const summaryRes = await call(testUserId, 'GET', `${base}/budget/summary`)
    expect(summaryRes.statusCode).toBe(200)
    await validateResponse('getBudgetSummary', 200, summaryRes.json())
    const summary = summaryRes.json().data
    expect(summary.totalIncomeMinor).toBe(350000)
    expect(summary.totalExpenseMinor).toBe(12000)
    expect(summary.netBalanceMinor).toBe(338000) // 350,000 - 12,000 = 338,000 ($3,380.00)
    expect(summary.pendingIncomeMinor).toBe(350000)
    expect(summary.clearedExpenseMinor).toBe(12000)

    // 5. Update status
    const patchRes = await call(testUserId, 'PATCH', `${base}/budget/${incomeItem.id}`, {
      status: 'cleared',
    })
    expect(patchRes.statusCode).toBe(200)
    expect(patchRes.json().data.status).toBe('cleared')

    // 6. Delete item
    const delRes = await call(testUserId, 'DELETE', `${base}/budget/${expenseItem.id}`)
    expect(delRes.statusCode).toBe(200)

    // List after delete
    const afterDel = await call(testUserId, 'GET', `${base}/budget`)
    expect(afterDel.json().total).toBe(1)
  })
})
