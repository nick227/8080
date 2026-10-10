import { buildApp } from './app'
import { loadPacks } from './bots/pack'
import { startBots, stopBots } from './bots/runtime'
import { startWorkspaceHost } from './services/WorkspaceHost'
import { startAgentRunner, stopAgentRunner } from './services/agents/runner'
import { describeEmailSetup } from './services/agents/email'
import { startTaskEmailSweep, stopTaskEmailSweep } from './services/taskEmail'
import { startTaskReminders, stopTaskReminders } from './services/taskReminders'

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
  const host = startWorkspaceHost()
  // Agents job runner (docs/agents/07 S0): single instance; AGENTS_SCHEDULER=off disables it.
  server.log.info(`agents runner: ${startAgentRunner() ? 'on' : 'off'}`)
  // Task notice emails: retries what an immediate send didn't finish.
  server.log.info(`task email sweep: ${startTaskEmailSweep() ? 'on' : 'off'}`)
  // Due tomorrow / overdue reminders for assignees, from 8 AM workspace time.
  server.log.info(`task reminders: ${startTaskReminders() ? 'on' : 'off'}`)
  const email = describeEmailSetup()
  if (email.ok) server.log.info(email.line)
  else server.log.error(email.line)

  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down server...`)
    try {
      stopAgentRunner()
      stopTaskEmailSweep()
      stopTaskReminders()
      host.stop()
      await stopBots()
      await server.close()
      process.exit(0)
    } catch (err) {
      server.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

