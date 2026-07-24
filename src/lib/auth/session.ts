import 'server-only'

import { SignJWT, jwtVerify } from 'jose'
import type { AppRole, PermissionSet } from '@/lib/access-control'

export const SESSION_COOKIE = 'abani_session'

export type SessionUser = {
  id: string
  name: string
  email: string
  role: AppRole
  warehouseId: string | null
  permissions: PermissionSet
}

function secret() {
  const value = process.env.APP_SESSION_SECRET?.trim()
  if (!value) throw new Error('Missing required environment variable: APP_SESSION_SECRET')
  return new TextEncoder().encode(value)
}

export async function signSession(user: SessionUser) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret())
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (typeof payload.id !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string') return null
    return {
      id: payload.id,
      name: typeof payload.name === 'string' ? payload.name : '',
      email: payload.email,
      role: payload.role as AppRole,
      warehouseId: typeof payload.warehouseId === 'string' ? payload.warehouseId : null,
      permissions: (payload.permissions && typeof payload.permissions === 'object' ? payload.permissions : {}) as PermissionSet,
    }
  } catch {
    return null
  }
}
