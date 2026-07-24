import 'server-only'

import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession, type SessionUser } from '@/lib/auth/session'

export async function getApiUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return token ? verifySession(token) : null
}
