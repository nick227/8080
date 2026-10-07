// Exact prices, once (doc/13 A4): items made before priceMinor existed get it from the
// legacy float, in their workspace's currency. Idempotent — it only touches rows that
// still have no exact price — so it runs on every start (and as `inventory:prices`).
import { db } from '@project/db'
import { minorDigits } from '@project/shared'

export async function backfillPrices() {
  const currencies = await db.$queryRaw<{ c: string }[]>`
    SELECT DISTINCT w.defaultCurrency AS c FROM Inventory i JOIN Workspace w ON w.id = i.workspaceId
    WHERE i.priceMinor = 0 AND (i.price <> 0 OR i.currency <> w.defaultCurrency)`
  let updated = 0
  for (const { c } of currencies) {
    const scale = 10 ** minorDigits(c)
    updated += await db.$executeRaw`
      UPDATE Inventory i JOIN Workspace w ON w.id = i.workspaceId
      SET i.currency = w.defaultCurrency, i.priceMinor = ROUND(i.price * ${scale})
      WHERE w.defaultCurrency = ${c} AND i.priceMinor = 0 AND (i.price <> 0 OR i.currency <> w.defaultCurrency)`
  }
  return updated
}
