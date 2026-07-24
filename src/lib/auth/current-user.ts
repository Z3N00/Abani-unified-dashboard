import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifySession, type SessionUser } from '@/lib/auth/session'

export async function requireUser(): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const user = token ? await verifySession(token) : null
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'ADMIN') redirect('/')
  return user
}
