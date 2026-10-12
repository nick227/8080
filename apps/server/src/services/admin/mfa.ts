import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { TOTP, Secret } from 'otpauth'
import bcrypt from 'bcryptjs'
import { db, type Prisma } from '@project/db'
import { tokenFrom } from '../../lib/session'
import { badRequest, conflict, httpError } from '../../lib/errors'
import { authorizePlatform } from '../authorization/platform'
import { lockAdminMutation } from './lock'

const ELEVATION_MS = 15 * 60_000
const hash = (code: string) => createHash('sha256').update(`8080-staff-recovery:${code}`).digest('hex')
function key() {
  const value=Buffer.from(process.env.STAFF_MFA_KEY ?? '', 'base64')
  if(value.length!==32) throw httpError(503,'Staff MFA encryption is not configured','MFA_CONFIGURATION')
  return value
}
function seal(secret:string) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv)
  return [iv, cipher.update(secret,'utf8'), cipher.final(), cipher.getAuthTag()].map(b=>b.toString('base64url')).join('.')
}
function unseal(sealed:string) {
  const [iv,body,end,tag]=sealed.split('.').map(v=>Buffer.from(v,'base64url'))
  try { const cipher=createDecipheriv('aes-256-gcm',key(),iv!);cipher.setAuthTag(tag!);return Buffer.concat([cipher.update(body!),cipher.update(end!),cipher.final()]).toString('utf8') }
  catch {throw httpError(503,'Staff MFA secret could not be read','MFA_CONFIGURATION')}
}
const otp=(secret:string,label='staff')=>new TOTP({issuer:'8080',label,algorithm:'SHA1',digits:6,period:30,secret})
async function sessionFor(request:any, tx:Prisma.TransactionClient=db) {
  const token=tokenFrom(request)
  const session=token ? await tx.session.findUnique({where:{token}}) : null
  if(!session || session.expiresAt<=new Date() || session.userId!==request.user?.id) throw httpError(401,'Sign in again','UNAUTHORIZED')
  return session
}
export async function requireStaffMfa(request:any) {
  await authorizePlatform(request.user.id,'users.read')
  const session=await sessionFor(request)
  const factor=await db.staffMfa.findUnique({where:{userId:session.userId}})
  if(!factor?.confirmedAt || !session.adminMfaUntil || session.adminMfaUntil<=new Date()) throw httpError(403,'Verify staff MFA to continue','MFA_REQUIRED')
}
export async function staffMfaStatus(request:any) {
  await authorizePlatform(request.user.id,'users.read')
  const session=await sessionFor(request)
  const factor=await db.staffMfa.findUnique({where:{userId:session.userId}})
  return {enrolled:!!factor?.confirmedAt,verifiedUntil:factor?.confirmedAt ? session.adminMfaUntil?.toISOString() ?? null : null}
}
export async function staffMfaOperation(request:any, action:'enroll'|'verify', input:{password?:string;code?:string},requestId:string) {
  await authorizePlatform(request.user.id,'users.read')
  const result=await db.$transaction(async tx=>{
    await lockAdminMutation(tx)
    const {user}=await authorizePlatform(request.user.id,'users.read',tx)
    const session=await sessionFor(request,tx)
    const now=new Date()
    const factor=await tx.staffMfa.upsert({where:{userId:user.id},create:{userId:user.id,recoveryHashes:[]},update:{}})
    if(factor.lockedUntil && factor.lockedUntil>now) return {error:httpError(429,'Too many attempts. Try again in 15 minutes.','MFA_LOCKED')}
    const fail=async()=>{
      const failures=(factor.lockedUntil && factor.lockedUntil<=now ? 0 : factor.failures)+1
      await tx.staffMfa.update({where:{userId:user.id},data:{failures,lockedUntil:failures>=5 ? new Date(now.getTime()+ELEVATION_MS) : null}})
      return {error:httpError(403,'Verification failed','MFA_INVALID')}
    }
    if(action==='enroll') {
      if(factor.confirmedAt) throw conflict('An authenticator is already enrolled')
      if(!user.passwordHash) throw badRequest('Password reauthentication is required for enrollment. Contact the platform operator.','MFA_REAUTH_REQUIRED')
      if(!input.password || !await bcrypt.compare(input.password,user.passwordHash)) return fail()
      const secret=new Secret({size:20}).base32
      await tx.staffMfa.update({where:{userId:user.id},data:{pendingSecret:seal(secret),pendingUntil:new Date(now.getTime()+10*60_000),pendingSessionId:session.id}})
      return {data:{secret,uri:otp(secret,user.email ?? user.id).toString(),recoveryCodes:[] as string[],verifiedUntil:null as string|null}}
    }
    const enrolling=!factor.confirmedAt
    if(enrolling && (!factor.pendingSecret || !factor.pendingUntil || factor.pendingUntil<=now || factor.pendingSessionId!==session.id)) throw badRequest('Restart authenticator enrollment','MFA_ENROLLMENT_EXPIRED')
    const secret=unseal((enrolling ? factor.pendingSecret : factor.secret)!)
    const code=input.code ?? ''
    const delta=/^\d{6}$/.test(code) ? otp(secret).validate({token:code,window:1,timestamp:now.getTime()}) : null
    const counter=Math.floor(now.getTime()/30000)+(delta ?? 0)
    const hashes=Array.isArray(factor.recoveryHashes) ? factor.recoveryHashes as string[] : []
    const recovery=!enrolling && /^[a-f0-9]{32}$/.test(code) && hashes.includes(hash(code))
    if(!recovery && (delta===null || counter<=factor.lastCounter)) return fail()
    const recoveryCodes=enrolling ? Array.from({length:10},()=>randomBytes(16).toString('hex')) : []
    const verifiedUntil=new Date(now.getTime()+ELEVATION_MS)
    await tx.staffMfa.update({where:{userId:user.id},data:{
      ...(enrolling?{secret:factor.pendingSecret,confirmedAt:now,pendingSecret:null,pendingSessionId:null,pendingUntil:null,recoveryHashes:recoveryCodes.map(hash)}:{}),
      ...(recovery?{recoveryHashes:hashes.filter(v=>v!==hash(code))}:{lastCounter:counter}),failures:0,lockedUntil:null,
    }})
    await tx.session.update({where:{id:session.id},data:{adminMfaUntil:verifiedUntil}})
    await tx.adminAuditEvent.create({data:{actorId:user.id,targetUserId:user.id,action:enrolling?'staff.mfa.enrolled':recovery?'staff.mfa.recovery':'staff.mfa.verified',reason:'Staff authentication verified',requestId,before:{enrolled:!enrolling},after:{verifiedUntil:verifiedUntil.toISOString()}}})
    return {data:{secret:null,uri:null,recoveryCodes,verifiedUntil:verifiedUntil.toISOString()}}
  })
  if(result.error) throw result.error
  return result.data!
}
