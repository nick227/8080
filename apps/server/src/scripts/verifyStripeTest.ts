// Read-only provider connectivity preflight. Not an end-to-end webhook test.
import { stripeMode, stripeRead, premiumPrices } from '../services/admin/stripeSync'
async function main() {
  if(stripeMode()!==false)throw new Error('A restricted Stripe TEST key is required; live keys are refused')
  const result=await stripeRead('subscriptions?limit=1&status=all&expand[]=data.latest_invoice')
  if(!Array.isArray(result?.data)||typeof result.has_more!=='boolean'||result.data.some((s:any)=>s.livemode!==false))throw new Error('Unexpected test account response')
  console.log('PASS: Stripe test subscription read. No provider or local billing records changed.')
  console.log(`Configuration: webhook secret ${process.env.STRIPE_WEBHOOK_SECRET?'present':'missing'}; Premium price IDs ${premiumPrices().length}.`)
  console.log('PENDING: signed event delivery, customer linking, payment lifecycle, and suspension/reinstatement end-to-end verification.')
}
main().catch((e)=>{console.error(typeof e?.message==='string'?e.message:'Stripe test preflight failed');process.exitCode=1})
