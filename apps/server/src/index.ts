import { buildApp } from './app'

async function main() {
  const server = await buildApp({ logger: true })
  await server.listen({
    port: Number(process.env.PORT ?? 3001),
    host: '0.0.0.0',
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
