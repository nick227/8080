import { db } from '@project/db'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { SESSION_TTL_MS, userInclude } from '../lib/session'
import { conflict, httpError } from '../lib/errors'
import type { UserRow } from '../lib/serialize'

// Compared against when the email doesn't exist so login timing doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12)

function guestName(id: string) {
  return `Guest ${id.slice(-4).toUpperCase()}`
}

export class AuthService {
  async createGuest(input: { displayName?: string }) {
    const user = await db.user.create({ data: { isGuest: true } })
    const withProfile = await db.user.update({
      where: { id: user.id },
      data: { profile: { create: { displayName: input.displayName?.trim() || guestName(user.id) } } },
      include: userInclude,
    })
    const session = await this.createSession(user.id)
    return { user: withProfile, token: session.token }
  }

  // With a guest session: upgrade that user in place (keeps rooms, items, reactions).
  // Without a session: create a fresh account and session.
  async register(current: UserRow | null, input: { email: string; password: string; displayName?: string }) {
    if (current && !current.isGuest) throw conflict('Already registered', 'ALREADY_REGISTERED')

    const email = input.email.trim().toLowerCase()
    const taken = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (taken) throw conflict('Email already in use', 'EMAIL_TAKEN')

    const passwordHash = await bcrypt.hash(input.password, 12)
    const displayName = input.displayName?.trim()

    if (current) {
      const user = await db.user.update({
        where: { id: current.id },
        data: {
          email,
          passwordHash,
          isGuest: false,
          ...(displayName ? { profile: { update: { displayName } } } : {}),
        },
        include: userInclude,
      })
      return { user, token: null } // keep existing session
    }

    const user = await db.user.create({ data: { email, passwordHash, isGuest: false } })
    const withProfile = await db.user.update({
      where: { id: user.id },
      data: { profile: { create: { displayName: displayName || email.split('@')[0]!.slice(0, 50) } } },
      include: userInclude,
    })
    const session = await this.createSession(user.id)
    return { user: withProfile, token: session.token }
  }

  async login(input: { email: string; password: string }) {
    const user = await db.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: userInclude,
    })
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH)
    if (!user || !user.passwordHash || !valid || user.deletedAt) {
      throw httpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
    }
    if (user.suspendedAt) throw httpError(403, 'Account suspended', 'SUSPENDED')

    const session = await this.createSession(user.id)
    return { user, token: session.token }
  }

  async logout(token: string) {
    await db.session.deleteMany({ where: { token } })
  }

  private createSession(userId: string) {
    return db.session.create({
      data: {
        userId,
        token: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    })
  }
}
