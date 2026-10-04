import { buildApp } from './app'
import { loadPacks } from './bots/pack'
import { startBots } from './bots/runtime'

async function main() {
  const server = await buildApp({ logger: true })
  await server.listen({
    port: Number(process.env.PORT ?? 3001),
    host: '0.0.0.0',
  })
  // Bots (doc/08): packs are seeded on boot (idempotent). BOTS=off keeps them silent.
  const runtime = await startBots(loadPacks())
  server.log.info(`bots: ${runtime.seeded.map((b) => `${b.pack.handle}@${b.pack.version}`).join(', ') || 'none'}${process.env.BOTS === 'off' ? ' (BOTS=off)' : ''}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
