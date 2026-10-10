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

  async loginWithGoogle(input: {
    googleSub: string
    email?: string | null
    emailVerified?: boolean
    displayName?: string | null
    avatarUrl?: string | null
    currentSessionUser?: UserRow | null
  }) {
    const { googleSub, email, emailVerified, displayName, avatarUrl, currentSessionUser } = input

    // 1. Search by stable googleSub
    const existingBySub = await db.user.findUnique({
      where: { googleSub },
      include: userInclude,
    })

    if (existingBySub) {
      if (existingBySub.deletedAt) throw httpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
      if (existingBySub.suspendedAt) throw httpError(403, 'Account suspended', 'SUSPENDED')

      // If user has no avatar or displayName, update profile with Google details if present
      if (displayName || avatarUrl) {
        await db.profile.upsert({
          where: { userId: existingBySub.id },
          create: {
            userId: existingBySub.id,
            displayName: displayName || email?.split('@')[0] || `User ${existingBySub.id.slice(-4)}`,
            avatarUrl,
          },
          update: {
            ...(avatarUrl && !existingBySub.profile?.avatarUrl ? { avatarUrl } : {}),
          },
        })
      }

      const session = await this.createSession(existingBySub.id)
      return { user: existingBySub, token: session.token }
    }

    // 2. If user is currently authenticated with a session (guest or member), link googleSub to this session
    if (currentSessionUser) {
      const updated = await db.user.update({
        where: { id: currentSessionUser.id },
        data: {
          googleSub,
          ...(currentSessionUser.isGuest && email ? { email, isGuest: false } : {}),
          profile: {
            upsert: {
              create: {
                displayName: displayName || email?.split('@')[0] || currentSessionUser.profile?.displayName || 'Guest',
                avatarUrl,
              },
              update: {
                ...(displayName && currentSessionUser.isGuest ? { displayName } : {}),
                ...(avatarUrl ? { avatarUrl } : {}),
              },
            },
          },
        },
        include: userInclude,
      })
      const session = await this.createSession(updated.id)
      return { user: updated, token: session.token }
    }

    // 3. No active session and no match by googleSub: check if an existing password user has matching email
    if (email) {
      const existingByEmail = await db.user.findUnique({
        where: { email },
        include: userInclude,
      })

      if (existingByEmail) {
        if (existingByEmail.deletedAt) throw httpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS')
        if (existingByEmail.suspendedAt) throw httpError(403, 'Account suspended', 'SUSPENDED')

        // Secure account linking: only link if email is verified by Google and account has no existing googleSub
        if (emailVerified && !existingByEmail.googleSub) {
          const linkedUser = await db.user.update({
            where: { id: existingByEmail.id },
            data: {
              googleSub,
              profile: {
                upsert: {
                  create: {
                    displayName: displayName || email.split('@')[0]!,
                    avatarUrl,
                  },
                  update: {
                    ...(avatarUrl && !existingByEmail.profile?.avatarUrl ? { avatarUrl } : {}),
                  },
                },
              },
            },
            include: userInclude,
          })
          const session = await this.createSession(linkedUser.id)
          return { user: linkedUser, token: session.token }
        }
      }
    }

    // 4. Create new User account for Google user
    const newUser = await db.user.create({
      data: {
        email: email || null,
        googleSub,
        isGuest: false,
        profile: {
          create: {
            displayName: displayName || email?.split('@')[0] || 'User',
            avatarUrl: avatarUrl || null,
          },
        },
      },
      include: userInclude,
    })

    const session = await this.createSession(newUser.id)
    return { user: newUser, token: session.token }
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
