import assert from 'node:assert/strict'
import { blueprints, horizons, scenarioData } from '../src/features/blueprints/data'
assert.equal(blueprints.length, 3)
for (const bp of blueprints) {
  assert.equal(new Set(bp.tasks.map(t => t.id)).size, bp.tasks.length, `${bp.slug}: duplicate task keys`)
  assert.equal(new Set(bp.people.map(p => p.id)).size, bp.people.length)
  for (const horizon of horizons) {
    const data = scenarioData(bp, horizon)
    for (const task of data.tasks) {
      assert.ok(data.people.some(p => p.id === task.person), `${bp.slug}/${horizon}: missing owner for ${task.id}`)
      assert.ok(data.projects.some(p => p.id === task.project), `${bp.slug}/${horizon}: missing project`)
      assert.ok(task.outcome.trim() && task.detail.trim())
      assert.ok(task.day >= 0 && task.day < data.days)
      assert.ok(Number.isInteger(task.minutes) && task.minutes > 0)
      if (task.repeat !== undefined) assert.ok(Number.isInteger(task.repeat) && task.repeat >= 0 && task.repeat <= 6)
    }
    for (const milestone of data.milestones) {
      const tasks = data.tasks.filter(t => t.project === milestone.project)
      assert.ok(tasks.length > 0)
      assert.ok(milestone.day >= Math.max(...tasks.map(t => t.day)) && milestone.day < data.days)
    }
    const incomes = data.budget.filter(b => b.direction === 'income')
    const expenses = data.budget.filter(b => b.direction === 'expense')
    assert.ok(incomes.length > 0, `${bp.slug}/${horizon}: missing income lines`)
    assert.ok(expenses.length > 0, `${bp.slug}/${horizon}: missing expense lines`)
    assert.equal(data.totalIncome, incomes.reduce((s, b) => s + b.amount, 0))
    assert.equal(data.totalExpenses, expenses.reduce((s, b) => s + b.amount, 0))
    assert.equal(data.netMargin, data.totalIncome - data.totalExpenses)
    for (const line of data.budget) {
      assert.ok(Number.isSafeInteger(line.amount) && line.amount >= 0)
      assert.ok(line.label.trim() && line.note.trim())
      assert.ok(line.category)
      assert.ok(line.direction === 'income' || line.direction === 'expense')
      if (line.taskKey) {
        assert.ok(data.tasks.some(t => t.id === line.taskKey), `${bp.slug}/${horizon}: invalid task link ${line.taskKey}`)
      }
    }
  }
  assert.ok(scenarioData(bp, '90').tasks.length >= 10, `${bp.slug}: expected at least 10 realistic tasks`)
  assert.ok(scenarioData(bp, '90').projects.length >= 5, `${bp.slug}: expected at least 5 structured projects`)
  assert.ok(scenarioData(bp, '90').people.length >= 2, `${bp.slug}: expected at least 2 roles`)
}
console.log('Blueprint content: all three models validated as 90-day starter plans with unique tasks, valid owners/projects, coherent milestones, schedules and budgets.')
