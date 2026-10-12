import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@project/db'
import { buildTestApp, asAuth, testUserId, testOtherUserId, seedRoom, validateResponse } from './helpers'
import { reserveLiveCost, dispatchLiveCost, releaseLiveCost, settleLiveCost, markUnknownLiveCosts } from '../services/live/costLedger'
const app = buildTestApp()
let roomId:string
const future=()=>new Date(Math.min(Date.now()+60000, new Date().setUTCHours(24,0,0,0)))
const reserve=(key:string,amount=100n,userId=testUserId,room=roomId)=>reserveLiveCost({requestKey:key,userId,roomId:room,reservedMicros:amount,deadline:future()})
beforeEach(async()=>{
 roomId=(await seedRoom(app,testUserId)).id
 await db.user.update({where:{id:testOtherUserId},data:{isGuest:false}})
 await db.premiumGrant.createMany({data:[testUserId,testOtherUserId].map(userId=>({userId,grantedById:'test',reason:'Test access',expiresAt:new Date(Date.now()+86400000)}))})
 const policy={stopped:false,userDailyMicros:1000n,platformDailyMicros:1500n,userConcurrency:2,platformConcurrency:3}
 await db.liveCostPolicy.upsert({where:{id:1},create:{id:1,...policy},update:policy})
 await db.platformStaff.create({data:{userId:testUserId,role:'platform_owner',grantedById:'test'}})
})
describe('durable Live spending boundaries',()=>{
 it('defaults closed with no configured policy and never enables token issuance',async()=>{
  await db.liveCostPolicy.deleteMany()
  await expect(reserve('closed')).rejects.toMatchObject({code:'LIVE_SPENDING_STOPPED'})
  const token=await app.inject({url:`/rooms/${roomId}/live-token`,headers:asAuth(testUserId)})
  expect(token.statusCode).toBe(503);expect(token.json().code).toBe('LIVE_NOT_ENABLED')
 })
 it('reserves once for concurrent identical requests and rejects changed reuse',async()=>{
  const input={requestKey:'one',userId:testUserId,roomId,reservedMicros:100n,deadline:future()}
  const [a,b]=await Promise.all([reserveLiveCost(input),reserveLiveCost(input)])
  expect(a.id).toBe(b.id);expect(await db.liveCostReservation.count()).toBe(1)
  await expect(reserveLiveCost({...input,reservedMicros:200n})).rejects.toMatchObject({statusCode:409})
 })
 it('enforces the same personal budget across rooms under concurrent requests',async()=>{
  const other=(await seedRoom(app,testUserId)).id
  const results=await Promise.allSettled([reserve('a',600n),reserve('b',600n,testUserId,other)])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
  expect(await db.liveCostReservation.count()).toBe(1)
 })
 it('enforces platform ceiling across different users',async()=>{
  await reserve('first',900n)
  await expect(reserve('second',900n,testOtherUserId)).rejects.toMatchObject({code:'LIVE_BUDGET_EXHAUSTED'})
 })
 it('retains concurrency slots for unknown costs and never resets holds at midnight',async()=>{
  const a=await reserve('a'),b=await reserve('b')
  await db.liveCostReservation.updateMany({where:{id:{in:[a.id,b.id]}},data:{deadline:new Date(Date.now()-1000),periodStart:new Date('2020-01-01')}})
  await markUnknownLiveCosts()
  expect(await db.liveCostReservation.count({where:{status:'unknown'}})).toBe(2)
  await expect(reserve('c')).rejects.toMatchObject({code:'LIVE_CONCURRENCY_EXHAUSTED'})
  await db.liveCostPolicy.update({where:{id:1},data:{userConcurrency:9,platformConcurrency:9,userDailyMicros:250n}})
  await expect(reserve('d')).rejects.toMatchObject({code:'LIVE_BUDGET_EXHAUSTED'})
  await expect(releaseLiveCost(a.id)).rejects.toMatchObject({statusCode:409})
 })
 it('enforces platform concurrency and recovers unknown liability only with evidence',async()=>{
  await db.liveCostPolicy.update({where:{id:1},data:{platformConcurrency:1}})
  const a=await reserve('a');await dispatchLiveCost(a.id)
  await expect(reserve('b',100n,testOtherUserId)).rejects.toMatchObject({code:'LIVE_CONCURRENCY_EXHAUSTED'})
  await db.liveCostReservation.update({where:{id:a.id},data:{deadline:new Date(0)}});await markUnknownLiveCosts()
  await settleLiveCost(a.id,0n,'verified-no-usage')
  await expect(reserve('c',100n,testOtherUserId)).resolves.toHaveProperty('status','reserved')
 })
 it('dispatches at most once and refuses dispatch after an emergency stop',async()=>{
  const a=await reserve('a')
  const results=await Promise.allSettled([dispatchLiveCost(a.id),dispatchLiveCost(a.id)])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  await expect(releaseLiveCost(a.id)).rejects.toMatchObject({statusCode:409})
  const b=await reserve('b');await db.liveCostPolicy.update({where:{id:1},data:{stopped:true}})
  await expect(dispatchLiveCost(b.id)).rejects.toMatchObject({code:'LIVE_SPENDING_STOPPED'})
 })
 it('releases only undispatched work and rejects expired dispatch',async()=>{
  const a=await reserve('a',1000n)
  await releaseLiveCost(a.id);await releaseLiveCost(a.id)
  const b=await reserve('b',1000n)
  await db.liveCostReservation.update({where:{id:b.id},data:{deadline:new Date(0)}})
  await expect(dispatchLiveCost(b.id)).rejects.toMatchObject({statusCode:409})
  expect(await db.liveCostReservation.count({where:{status:'released'}})).toBe(1)
 })
 it('settles exact costs once, recovers unused capacity, and rejects conflicting evidence',async()=>{
  const a=await reserve('a',1000n);await dispatchLiveCost(a.id)
  await settleLiveCost(a.id,100n,'usage-a');await settleLiveCost(a.id,100n,'usage-a')
  expect(await db.adminAuditEvent.count({where:{action:'live.cost.settled'}})).toBe(1)
  await expect(settleLiveCost(a.id,90n,'usage-a')).rejects.toMatchObject({statusCode:409})
  const b=await reserve('b',900n);await dispatchLiveCost(b.id)
  await expect(settleLiveCost(b.id,100n,'usage-a')).rejects.toMatchObject({statusCode:409})
  await expect(reserve('c',1n)).rejects.toMatchObject({code:'LIVE_BUDGET_EXHAUSTED'})
 })
 it('records overrun in full and latches stop without losing the provider liability',async()=>{
  const a=await reserve('a',100n);await dispatchLiveCost(a.id)
  await settleLiveCost(a.id,2000n,'provider-overrun')
  expect((await db.liveCostReservation.findUniqueOrThrow({where:{id:a.id}})).actualMicros).toBe(2000n)
  expect((await db.liveCostPolicy.findUniqueOrThrow({where:{id:1}})).stopped).toBe(true)
  await expect(reserve('after')).rejects.toMatchObject({code:'LIVE_SPENDING_STOPPED'})
 })
 it('rejects invalid money, expired windows, Free accounts, and suspended dispatch',async()=>{
  await expect(reserve('zero',0n)).rejects.toMatchObject({statusCode:400})
  await expect(reserve('negative',-1n)).rejects.toMatchObject({statusCode:400})
  await expect(reserveLiveCost({requestKey:'late',userId:testUserId,roomId,reservedMicros:100n,deadline:new Date(Date.now()+2*86400000)})).rejects.toMatchObject({statusCode:400})
  await db.premiumGrant.deleteMany({where:{userId:testOtherUserId}})
  await expect(reserve('free',100n,testOtherUserId)).rejects.toMatchObject({code:'PREMIUM_REQUIRED'})
  const a=await reserve('valid');await db.user.update({where:{id:testUserId},data:{suspendedAt:new Date()}})
  await expect(dispatchLiveCost(a.id)).rejects.toMatchObject({code:'ACCOUNT_SUSPENDED'})
 })
 it('protects stop with owner authority, confirmation, optimistic version and durable audit',async()=>{
  const payload={expectedVersion:0,reason:'Provider incident',confirmed:true}
  await db.platformStaff.create({data:{userId:testOtherUserId,role:'platform_admin',grantedById:'test'}})
  const stop=(userId:string,body=payload)=>app.inject({method:'POST',url:'/admin/live-costs/stop',headers:asAuth(userId),payload:body})
  expect((await stop(testOtherUserId)).statusCode).toBe(403)
  expect((await stop(testUserId,{...payload,confirmed:false})).statusCode).toBe(400)
  const stopped=await stop(testUserId);expect(stopped.statusCode).toBe(200);expect(stopped.json().data.stopped).toBe(true)
  await validateResponse('stopAdminLiveSpending',200,stopped.json())
  expect((await stop(testUserId)).statusCode).toBe(409)
  expect(await db.adminAuditEvent.count({where:{action:'live.spending.stop'}})).toBe(1)
  const get=await app.inject({url:'/admin/live-costs',headers:asAuth(testUserId)});await validateResponse('getAdminLiveCosts',200,get.json())
 })
})
