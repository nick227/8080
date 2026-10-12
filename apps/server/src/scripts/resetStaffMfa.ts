// Operator-only recovery: verify identity out of band before running. No HTTP reset.
import { db } from '@project/db'
import { randomUUID } from 'crypto'
import { lockAdminMutation } from '../services/admin/lock'
async function main() {
  const [userId,reason]=process.argv.slice(2)
  if(!userId||!reason||reason.trim().length<3||reason.length>500||process.argv.length!==4)throw new Error('Usage: admin:mfa-reset <exact-user-id> <verified-recovery-reason>')
  await db.$transaction(async tx=>{
    await lockAdminMutation(tx)
    const staff=await tx.platformStaff.findUnique({where:{userId}})
    if(!staff)throw new Error('User is not platform staff')
    await tx.staffMfa.deleteMany({where:{userId}})
    await tx.session.deleteMany({where:{userId}})
    await tx.adminAuditEvent.create({data:{actorId:'operator-cli',targetUserId:userId,action:'staff.mfa.reset',reason:reason.trim(),requestId:randomUUID(),before:{staffRole:staff.role},after:{sessionsRevoked:true,enrollmentRequired:true}}})
  })
  console.log('Staff MFA reset and login sessions revoked. Recovery was audited.')
}
main().catch(()=>{console.error('MFA reset failed. Check the exact user ID, reason, and database configuration.');process.exitCode=1}).finally(()=>db.$disconnect())
