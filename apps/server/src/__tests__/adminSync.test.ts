import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Stripe from 'stripe'
import type { FastifyInstance } from 'fastify'
import { db } from '@project/db'
import { buildApp } from '../app'
import { entitlements } from '../services/admin/entitlements'
import { validateResponse } from './helpers'

let app: FastifyInstance
const owner='sync-owner', user='sync-user', admin='sync-admin'
const headers=(id=owner)=>({authorization:`Bearer session-${id}`})
const fetchMock=vi.fn()
const secret='whsec_unit_test_only'
const end=()=>Math.floor(Date.now()/1000)+86400
const sub=(extra: Record<string,unknown>={})=>({id:'sub_premium',customer:'cus_premium',livemode:false,status:'active',cancel_at_period_end:false,cancel_at:null,pause_collection:null,items:{has_more:false,data:[{current_period_end:end(),price:{id:'price_premium',type:'recurring',recurring:{interval:'month',interval_count:1}}}]},latest_invoice:{id:'in_paid',livemode:false,customer:'cus_premium',status:'paid',parent:{subscription_details:{subscription:'sub_premium'}}},...extra})
const provider=(value:unknown)=>fetchMock.mockImplementation(async()=>new Response(JSON.stringify(value)))
const post=(path:string,payload:unknown,id=owner)=>app.inject({method:'POST',url:path,headers:headers(id),payload:payload as any})
const version=async(id=user)=>(await db.user.findUniqueOrThrow({where:{id}})).adminVersion
const link=async(id=user)=>{provider({id:'cus_premium',livemode:false});return post(`/admin/users/${id}/billing-customer`,{customerId:'cus_premium',expectedVersion:await version(id),reason:'Verified billing owner',confirmed:true})}
const sync=()=>post('/admin/subscriptions/sub_premium/sync',{reason:'Recover missed billing update',confirmed:true})
const event=(id='evt_one',type='customer.subscription.updated',obj:unknown={id:'sub_premium'},extra={})=>({id,object:'event',type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:obj},...extra})
const webhook=(value:unknown,timestamp=Math.floor(Date.now()/1000))=>{
 const payload=JSON.stringify(value);const signature=Stripe.webhooks.generateTestHeaderString({payload,secret,timestamp})
 return app.inject({method:'POST',url:'/billing/stripe/webhook',headers:{'content-type':'application/json','stripe-signature':signature},payload})
}
beforeAll(async()=>{app=await buildApp({ adminMfa: false,docs:false,rateLimit:false,logger:process.env.TEST_LOG ? {level:'error'} : false});await app.ready()})
afterAll(()=>app.close())
beforeEach(async()=>{
 vi.stubEnv('STRIPE_READONLY_KEY','rk_test_unit');vi.stubEnv('STRIPE_WEBHOOK_SECRET',secret);vi.stubEnv('STRIPE_PREMIUM_PRICE_IDS','price_premium');vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset()
 for(const id of [owner,user,admin]){await db.user.create({data:{id,isGuest:false,email:`${id}@test.local`}});await db.session.create({data:{userId:id,token:`session-${id}`,expiresAt:new Date(Date.now()+86400000)}})}
 await db.platformStaff.createMany({data:[{userId:owner,role:'platform_owner',grantedById:'test'},{userId:admin,role:'platform_admin',grantedById:owner}]})
})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})

describe('signed Stripe synchronization and independent paid access',()=>{
 it('rejects absent, tampered, old and wrong-mode signatures without writes or provider calls',async()=>{
  const no=await app.inject({method:'POST',url:'/billing/stripe/webhook',headers:{'content-type':'application/json'},payload:event()});expect(no.statusCode).toBe(400)
  const raw=JSON.stringify(event());const sig=Stripe.webhooks.generateTestHeaderString({payload:raw,secret})
  expect((await app.inject({method:'POST',url:'/billing/stripe/webhook',headers:{'content-type':'application/json','stripe-signature':sig},payload:raw+' '})).statusCode).toBe(400)
  expect((await webhook(event(),Math.floor(Date.now()/1000)-600)).statusCode).toBe(400)
  expect((await webhook(event('evt_wrong','customer.subscription.updated',{id:'sub_premium'},{livemode:true}))).statusCode).toBe(400)
  expect((await webhook(event('evt_connect','customer.subscription.updated',{id:'sub_premium'},{account:'acct_other'}))).statusCode).toBe(400)
  expect(fetchMock).not.toHaveBeenCalled();expect(await db.stripeWebhookReceipt.count()).toBe(0)
 })
 it('requires explicit customer binding, ignores metadata for access, and verifies fresh state after linking',async()=>{
  provider(sub({metadata:{'8080_user_id':user}}))
  expect((await webhook(event())).statusCode).toBe(200)
  expect((await entitlements(user)).tier).toBe('free')
  expect((await link()).statusCode).toBe(200)
  expect((await entitlements(user)).tier).toBe('free')
  provider(sub());expect((await sync()).statusCode).toBe(200)
  expect(await entitlements(user)).toMatchObject({tier:'premium',source:'stripe',liveAvailable:false})
  const detail=await app.inject({url:`/admin/users/${user}`,headers:headers()});expect(detail.json().data.billing.customerId).toBe('cus_premium');await validateResponse('getAdminUser',200,detail.json())
  expect(fetchMock.mock.calls.every(([,opts])=>opts.method==='GET')).toBe(true)
 })
 it('deduplicates concurrent deliveries and fetches current state for late events',async()=>{
  await link();provider(sub())
  const results=await Promise.all([webhook(event()),webhook(event())]);expect(results.map(r=>r.statusCode)).toEqual([200,200])
  expect(await db.stripeWebhookReceipt.count()).toBe(1);expect(await db.adminAuditEvent.count({where:{action:'billing.sync'}})).toBe(1)
  provider(sub({status:'canceled'}))
  expect((await webhook(event('evt_late','customer.subscription.created',{id:'sub_premium',status:'active'},{created:1}))).statusCode).toBe(200)
  expect((await entitlements(user)).tier).toBe('free')
 })
 it('rolls back failed provider work and permits retry of the same event',async()=>{
  await link();fetchMock.mockRejectedValue(new Error('secret provider failure rk_test_unit'))
  const failed=await webhook(event());expect(failed.statusCode).toBe(502);expect(failed.body).not.toContain('rk_test_unit')
  expect(await db.stripeWebhookReceipt.count()).toBe(0);expect(await db.stripeSubscription.count()).toBe(0)
  provider(sub());expect((await webhook(event())).statusCode).toBe(200);expect((await entitlements(user)).tier).toBe('premium')
 })
 it.each(['trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'])('does not grant paid access for %s',async status=>{
  await link();provider(sub({status}));expect((await sync()).statusCode).toBe(200);expect((await entitlements(user)).tier).toBe('free')
 })
 it('fails closed for unrelated prices, unpaid invoices, mismatched invoices, paused collection and expired periods',async()=>{
  await link()
  for(const override of [
   {items:{data:[{current_period_end:end(),price:{id:'price_other',type:'recurring',recurring:{interval:'month'}}}]}},
   {latest_invoice:{status:'open'}}, {latest_invoice:{status:'paid',livemode:false,customer:'cus_other',parent:{subscription_details:{subscription:'sub_premium'}}}},
   {pause_collection:{behavior:'void'}}, {items:{data:[{current_period_end:1,price:{id:'price_premium',type:'recurring',recurring:{interval:'month'}}}]}},
  ]){provider(sub(override));expect((await sync()).statusCode).toBe(200);expect((await entitlements(user)).tier).toBe('free')}
 })
 it('expires without a job, respects scheduled cancellation, and test data never grants production access',async()=>{
  await link();const cancel=Math.floor(Date.now()/1000)+60;provider(sub({cancel_at:cancel,cancel_at_period_end:true}));await sync()
  expect((await entitlements(user)).expiresAt).toBe(new Date(cancel*1000).toISOString())
  expect((await entitlements(user,db,new Date(cancel*1000+1))).tier).toBe('free')
  vi.stubEnv('NODE_ENV','production');expect((await entitlements(user)).tier).toBe('free')
 })
 it('processes invoice events and does not acknowledge unsuccessful synchronization',async()=>{
  await link();provider(sub());expect((await webhook(event('evt_invoice','invoice.paid',{parent:{subscription_details:{subscription:'sub_premium'}}}))).statusCode).toBe(200)
  expect((await entitlements(user)).tier).toBe('premium')
  provider(sub({status:'past_due'}));expect((await webhook(event('evt_failed','invoice.payment_failed',{parent:{subscription_details:{subscription:'sub_premium'}}}))).statusCode).toBe(200)
  expect((await entitlements(user)).tier).toBe('free')
 })
 it('grant revocation preserves paid access and records the correct preview and audit',async()=>{
  await link();provider(sub());await sync()
  await db.premiumGrant.create({data:{userId:user,grantedById:owner,expiresAt:new Date(Date.now()+3600000),reason:'Support grant'}})
  const expectedVersion=await version();const preview=await post(`/admin/users/${user}/preview`,{action:'revoke_premium',expectedVersion})
  expect(preview.json().data.after.tier).toBe('premium')
  const change=await post(`/admin/users/${user}/actions`,{action:'revoke_premium',expectedVersion,confirmed:true,reason:'Remove support grant'})
  expect(change.statusCode).toBe(200);expect(change.json().data.premium.source).toBe('stripe')
  expect((await db.adminAuditEvent.findFirst({where:{action:'revoke_premium'}}))?.after).toMatchObject({tier:'premium'})
 })
 it('invalidates an open grant confirmation when billing changes and preserves grants after cancellation',async()=>{
  await link();provider(sub());await sync()
  const expectedVersion=await version()
  await db.premiumGrant.create({data:{userId:user,grantedById:owner,expiresAt:new Date(Date.now()+3600000),reason:'Retained support grant'}})
  provider(sub({status:'canceled'}));expect((await webhook(event('evt_cancel'))).statusCode).toBe(200)
  expect((await entitlements(user)).source).toBe('grant')
  const stale=await post(`/admin/users/${user}/actions`,{action:'revoke_premium',expectedVersion,confirmed:true,reason:'Old confirmation'})
  expect(stale.statusCode).toBe(409);expect((await entitlements(user)).tier).toBe('premium')
 })
 it('prefers a verified binding over conflicting display metadata in Billing',async()=>{
  await link();provider({data:[sub({metadata:{'8080_user_id':owner}})],has_more:false})
  const list=await app.inject({url:'/admin/subscriptions',headers:headers()})
  expect(list.statusCode).toBe(200);expect(list.json().data[0]).toMatchObject({linkVerified:true,user:{id:user}})
  await validateResponse('getAdminSubscriptions',200,list.json())
 })
 it('restricts linking and reconciliation to owners and rejects stale or duplicate bindings',async()=>{
  const body={customerId:'cus_premium',expectedVersion:0,reason:'Verified owner',confirmed:true}
  expect((await post(`/admin/users/${user}/billing-customer`,body,admin)).statusCode).toBe(403)
  expect((await post('/admin/subscriptions/sub_premium/sync',{reason:'Retry sync',confirmed:true},admin)).statusCode).toBe(403)
  expect(fetchMock).not.toHaveBeenCalled()
  expect((await link()).statusCode).toBe(200)
  expect((await post(`/admin/users/${user}/billing-customer`,body)).statusCode).toBe(409)
  expect((await post(`/admin/users/${owner}/billing-customer`,body)).statusCode).toBe(409)
  expect(await db.stripeCustomerBinding.count()).toBe(1)
 })
})

describe('owner-managed staff roles',()=>{
 const staff=(id:string,role:unknown,expectedVersion=0,actor=owner)=>post(`/admin/users/${id}/staff`,{role,expectedVersion,confirmed:true,reason:'Verified staff appointment'},actor)
 it('exposes readiness and assigns/revokes roles with audit, leaving Premium and workspace access unchanged',async()=>{
  const settings=await app.inject({url:'/admin/settings',headers:headers()});expect(settings.statusCode).toBe(200);await validateResponse('getAdminSettings',200,settings.json());expect(settings.json().data.checkout.enabled).toBe(false)
  expect((await staff(user,'platform_admin')).statusCode).toBe(200);expect((await entitlements(user)).tier).toBe('free');expect(await db.workspaceMember.count({where:{userId:user}})).toBe(0)
  expect((await staff(user,null,1)).statusCode).toBe(200);expect(await db.platformStaff.findUnique({where:{userId:user}})).toBeNull();expect(await db.adminAuditEvent.count({where:{action:'staff.change'}})).toBe(2)
 })
 it('denies admin escalation, self-demotion, guests, suspended targets and stale confirmations',async()=>{
  expect((await staff(user,'platform_owner',0,admin)).statusCode).toBe(403)
  expect((await staff(owner,null)).statusCode).toBe(400)
  await db.user.update({where:{id:user},data:{isGuest:true}});expect((await staff(user,'platform_admin')).statusCode).toBe(404)
  await db.user.update({where:{id:user},data:{isGuest:false,suspendedAt:new Date()}});expect((await staff(user,'platform_admin')).statusCode).toBe(400)
  await db.user.update({where:{id:user},data:{suspendedAt:null}});expect((await staff(user,'platform_admin')).statusCode).toBe(200);expect((await staff(user,'platform_owner')).statusCode).toBe(409)
 })
 it('serializes competing owner demotions and leaves an active owner',async()=>{
  await db.platformStaff.create({data:{userId:user,role:'platform_owner',grantedById:owner}})
  const results=await Promise.all([staff(user,'platform_admin'),staff(owner,'platform_admin',0,user)])
  expect(results.filter(r=>r.statusCode===200)).toHaveLength(1)
  expect(results.filter(r=>r.statusCode===403)).toHaveLength(1)
  expect(await db.platformStaff.count({where:{role:'platform_owner'}})).toBe(1)
 })
 it('requires CSRF and a trusted Origin for cookie-authenticated staff/billing writes',async()=>{
  for(const path of [`/admin/users/${user}/staff`,`/admin/users/${user}/billing-customer`,'/admin/subscriptions/sub_premium/sync']){
   const payload=path.endsWith('/staff')?{role:'platform_admin',expectedVersion:0,reason:'Support request',confirmed:true}:path.endsWith('billing-customer')?{customerId:'cus_premium',expectedVersion:0,reason:'Support request',confirmed:true}:{reason:'Support request',confirmed:true}
   const res=await app.inject({method:'POST',url:path,headers:{cookie:'token=session-sync-owner'},payload});expect(res.statusCode).toBe(403)
  }
 })
})
