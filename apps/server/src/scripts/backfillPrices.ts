// Backfill: exact prices (priceMinor + currency) for items made before A4. Safe to
// re-run; the server also runs it on start.
//   local:   set -a; . ../../.env; set +a; pnpm --filter server inventory:prices
//   Railway: railway run pnpm --filter server inventory:prices
import { db } from '@project/db'
import { backfillPrices } from '../services/priceBackfill'

backfillPrices()
  .then((n) => console.log(`inventory:prices — ${n} item(s) given an exact price`))
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => db.$disconnect())
