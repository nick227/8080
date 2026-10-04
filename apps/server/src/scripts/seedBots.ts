// Load every pack in apps/server/bots into the DB (idempotent; the server also does
// this on boot).   local: set -a; . ../../.env; set +a; pnpm bots:seed
import { db } from '@project/db'
import { loadPacks } from '../bots/pack'
import { seedPacks } from '../bots/seed'

async function main() {
  const seeded = await seedPacks(loadPacks())
  for (const s of seeded) console.log(`${s.pack.handle}  v${s.pack.version}  ${s.pack.lines.length} lines  ${s.pack.workflows.length} workflows`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
