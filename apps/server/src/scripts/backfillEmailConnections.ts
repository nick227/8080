// Gives every workspace created before Agents its "Send with 8080" connection
// (docs/agents/07 S0). Idempotent; reading a workspace's connections does the same.
// Run: pnpm --filter server email:backfill
import { db } from '@project/db'
import { defaultConnection } from '../services/agents/connections'

async function main() {
  const workspaces = await db.workspace.findMany({ where: { emailConnections: { none: { defaultFor: { not: null } } } }, select: { id: true, name: true } })
  for (const w of workspaces) {
    await defaultConnection(w.id)
    console.log(`  ${w.name}: Send with 8080`)
  }
  console.log(`email:backfill — ${workspaces.length} workspace(s) given a default sender`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
