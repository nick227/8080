import { buildApp } from './app'
import { loadPacks } from './bots/pack'
import { startBots } from './bots/runtime'
import { startWorkspaceHost } from './services/WorkspaceHost'
import { backfillPrices } from './services/priceBackfill'

async function main() {
  const server = await buildApp({ logger: true })
  await server.listen({
    port: Number(process.env.PORT ?? 3001),
    host: '0.0.0.0',
  })
  // Bots (doc/08): packs are seeded on boot (idempotent). BOTS=off keeps them silent.
  const runtime = await startBots(loadPacks())
  server.log.info(`bots: ${runtime.seeded.map((b) => `${b.pack.handle}@${b.pack.version}`).join(', ') || 'none'}${process.env.BOTS === 'off' ? ' (BOTS=off)' : ''}`)
  // chatbot as workspace host (doc/12): channel welcomes and the company-profile flow.
  startWorkspaceHost()
  // Exact prices for items made before priceMinor existed (doc/13 A4); idempotent.
  void backfillPrices().then((n) => { if (n) server.log.info(`inventory: ${n} item(s) given an exact price`) }).catch((error) => server.log.error(error, 'price backfill failed'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
