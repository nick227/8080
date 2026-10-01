import { db } from '@project/db'
import { userInclude } from '../lib/session'

export class UserService {
  async updateMe(userId: string, input: { displayName?: string; avatarUrl?: string | null }) {
    const displayName = input.displayName?.trim()
    return db.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            ...(displayName ? { displayName } : {}),
            ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
          },
        },
      },
      include: userInclude,
    })
  }
}
