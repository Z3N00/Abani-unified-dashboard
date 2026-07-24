import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearStaffDirectoryCache } from '@/lib/users/data'

export async function POST(request: Request) {
  const user = await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? '')
  if (user?.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const db = createAdminClient()
  const { error } = await db.from('UserPermission').upsert({
    id: crypto.randomUUID(),
    userId: String(body.userId),
    permissions: body.permissions ?? {},
    preset: 'custom',
    updatedAt: new Date().toISOString(),
    updatedBy: user.id,
  }, { onConflict: 'userId' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  clearStaffDirectoryCache()
  return NextResponse.json({ ok: true })
}
