import type { FastifyInstance } from 'fastify'
import { receiveStripeWebhook } from '../services/admin/stripeSync'

// Encapsulated parser: regular API JSON parsing is unchanged.
export default async function stripeWebhook(app: FastifyInstance) {
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_request, body, done) => done(null, body))
  app.post('/billing/stripe/webhook', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const header = request.headers['stripe-signature']
    return reply.header('Cache-Control', 'no-store').send(await receiveStripeWebhook(request.body as Buffer, typeof header === 'string' ? header : undefined))
  })
}
