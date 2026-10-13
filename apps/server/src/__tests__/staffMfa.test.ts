import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { TOTP } from 'otpauth'
import bcrypt from 'bcryptjs'
import { db } from '@project/db'
import { buildApp } from '../app'
import { validateResponse } from './helpers'
import type { FastifyInstance } from 'fastify'
let app:FastifyInstance
const id='mfa-staff',password='test-password-123'
const auth=(session='one')=>({authorization:`Bearer mfa-${session}`})
const otp=(secret:string,offset=0)=>new TOTP({secret}).generate({timestamp:Date.now()+offset*30000})
const post=(path:string,payload:object,session='one')=>app.inject({method:'POST',url:path,headers:auth(session),payload})
const enroll=()=>post('/admin/mfa/enroll',{password})
beforeAll(async()=>{app=await buildApp({docs:false,rateLimit:false});await app.ready()})
afterAll(()=>app.close())
beforeEach(async()=>{
 vi.stubEnv('STAFF_MFA_KEY',Buffer.alloc(32,19).toString('base64'))
 await db.user.create({data:{id,isGuest:false,email:'mfa@example.test',passwordHash:await bcrypt.hash(password,4)}})
 await db.platformStaff.create({data:{userId:id,role:'platform_owner',grantedById:'test'}})
 for(const s of ['one','two'])await db.session.create({data:{userId:id,token:`mfa-${s}`,expiresAt:new Date(Date.now()+86400000)}})
})
afterEach(()=>vi.unstubAllEnvs())
describe('platform staff role-based access and dormant MFA infrastructure',()=>{
 it('allows staff with active session direct role-based access to admin endpoints while denying non-staff and unauthenticated callers',async()=>{
  const me=await app.inject({url:'/admin/me',headers:auth()});expect(me.statusCode).toBe(200);expect(me.json().data.role).toBe('platform_owner');await validateResponse('getAdminSession',200,me.json())
  for(const url of ['/admin/users','/admin/settings','/admin/subscriptions','/admin/live-costs','/admin/push/deliveries']){
   const r=await app.inject({url,headers:auth()});expect(r.statusCode).toBe(200)
  }
  const nonStaffId='mfa-nonstaff'
  await db.user.create({data:{id:nonStaffId,isGuest:false,email:'nonstaff@example.test'}})
  await db.session.create({data:{userId:nonStaffId,token:'mfa-nonstaff-token',expiresAt:new Date(Date.now()+86400000)}})
  const nonStaffHeaders={authorization:'Bearer mfa-nonstaff-token'}
  expect((await app.inject({url:'/admin/me',headers:nonStaffHeaders})).statusCode).toBe(403)
  for(const url of ['/admin/users','/admin/settings','/admin/subscriptions','/admin/live-costs','/admin/push/deliveries']){
   expect((await app.inject({url,headers:nonStaffHeaders})).statusCode).toBe(403)
  }
  expect((await app.inject({url:'/admin/users'})).statusCode).toBe(401)
  expect((await app.inject({url:'/admin/me'})).statusCode).toBe(401)
 })
 it('preserves dormant MFA enrollment: requires password, encrypts secret, confirms enrollment and generates recovery codes',async()=>{
  expect((await post('/admin/mfa/enroll',{password:'wrong'})).statusCode).toBe(403)
  const setup=await enroll();expect(setup.statusCode).toBe(200);await validateResponse('enrollStaffMfa',200,setup.json())
  const secret=setup.json().data.secret
  const row=await db.staffMfa.findUniqueOrThrow({where:{userId:id}});expect(row.pendingSecret).not.toContain(secret);expect(row.confirmedAt).toBeNull()
  expect((await post('/admin/mfa/verify',{code:otp(secret)},'two')).statusCode).toBe(400)
  const verified=await post('/admin/mfa/verify',{code:otp(secret)});expect(verified.statusCode).toBe(200);await validateResponse('verifyStaffMfa',200,verified.json())
  expect(verified.json().data.recoveryCodes).toHaveLength(10)
  expect((await enroll()).statusCode).toBe(409)
  expect(JSON.stringify(await db.adminAuditEvent.findMany())).not.toContain(secret)
 })
 it('rejects code replay and verifies a fresh code against dormant MFA',async()=>{
  const secret=(await enroll()).json().data.secret
  expect((await post('/admin/mfa/verify',{code:otp(secret)})).statusCode).toBe(200)
  expect((await post('/admin/mfa/verify',{code:otp(secret)},'two')).statusCode).toBe(403)
  expect((await post('/admin/mfa/verify',{code:otp(secret,1)},'two')).statusCode).toBe(200)
 })
 it('consumes recovery codes atomically and never stores or audits the plaintext',async()=>{
  const secret=(await enroll()).json().data.secret
  const codes=(await post('/admin/mfa/verify',{code:otp(secret)})).json().data.recoveryCodes
  const results=await Promise.all([post('/admin/mfa/verify',{code:codes[0]},'two'),post('/admin/mfa/verify',{code:codes[0]},'two')])
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,403])
  expect(JSON.stringify(await db.staffMfa.findMany())).not.toContain(codes[0]);expect(JSON.stringify(await db.adminAuditEvent.findMany())).not.toContain(codes[0])
 })
 it('persists account-level throttling across sessions',async()=>{
  for(let n=0;n<5;n++)expect((await post('/admin/mfa/enroll',{password:'wrong'},n%2?'one':'two')).statusCode).toBe(403)
  expect((await enroll()).statusCode).toBe(429)
  expect((await db.staffMfa.findUniqueOrThrow({where:{userId:id}})).failures).toBe(5)
 })
 it('rejects expired pending enrollment, missing encryption, nonstaff, suspended and OAuth-only enrollment',async()=>{
  const secret=(await enroll()).json().data.secret
  await db.staffMfa.update({where:{userId:id},data:{pendingUntil:new Date(0)}})
  expect((await post('/admin/mfa/verify',{code:otp(secret)})).statusCode).toBe(400)
  vi.stubEnv('STAFF_MFA_KEY','');expect((await enroll()).statusCode).toBe(503)
  await db.user.update({where:{id},data:{passwordHash:null}});expect((await enroll()).json().code).toBe('MFA_REAUTH_REQUIRED')
  await db.user.update({where:{id},data:{suspendedAt:new Date()}});expect((await app.inject({url:'/admin/mfa',headers:auth()})).statusCode).toBe(403)
  await db.user.update({where:{id},data:{suspendedAt:null}});await db.platformStaff.deleteMany();expect((await app.inject({url:'/admin/mfa',headers:auth()})).statusCode).toBe(403)
 })
 it('requires CSRF for cookie enrollment and rejects session loss after verification',async()=>{
  expect((await app.inject({method:'POST',url:'/admin/mfa/enroll',headers:{cookie:'token=mfa-one'},payload:{password}})).statusCode).toBe(403)
  const secret=(await enroll()).json().data.secret;await post('/admin/mfa/verify',{code:otp(secret)})
  await db.session.deleteMany();expect((await app.inject({url:'/admin/me',headers:auth()})).statusCode).toBe(401)
 })
})
