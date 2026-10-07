// Backfill + verify exact prices (priceMinor + currency) for items made before A4.
// Safe to re-run. Retirement plan (doc/13 §14.1): run once on Railway, see
// "mismatched: 0", then remove the startup call, the legacy float and its dual writes.
//   local:   set -a; . ../../.env; set +a; pnpm --filter server inventory:prices
//   Railway: railway run pnpm --filter server inventory:prices
import { db } from '@project/db'
import { minorDigits } from '@project/shared'
import { backfillPrices } from '../services/priceBackfill'

async function main() {
  const updated = await backfillPrices()
  // Every row's exact price must equal its legacy float, at its currency's scale.
  const rows = await db.inventory.findMany({ select: { id: true, price: true, priceMinor: true, currency: true } })
  const mismatched = rows.filter((r) => Math.round(r.price * 10 ** minorDigits(r.currency)) !== r.priceMinor)
  console.log(`inventory:prices — ${updated} item(s) given an exact price · ${rows.length} checked · mismatched: ${mismatched.length}`)
  for (const r of mismatched.slice(0, 20)) console.log(`  ${r.id}: price ${r.price} vs priceMinor ${r.priceMinor} ${r.currency}`)
  if (mismatched.length) process.exitCode = 2
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
