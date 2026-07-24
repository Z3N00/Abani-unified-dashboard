import { NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { SESSION_COOKIE, signSession } from '@/lib/auth/session'
import { APP_ROLES, type AppRole, type PermissionSet } from '@/lib/access-control'

type DatabaseUser = {
  id: string
  name: string | null
  email: string
  password: string
  role: string
  warehouseId: string | null
}

function isRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 })

    const database = createAdminClient()
    const { data: user, error } = await database
      .from('User')
      .select('id, name, email, password, role, warehouseId')
      .ilike('email', email)
      .maybeSingle<DatabaseUser>()

    if (error) throw error
    if (!user || !(await compare(password, user.password))) {
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 })
    }

    const { data: permissionRecord, error: permissionError } = await database
      .from('UserPermission')
      .select('permissions')
      .eq('userId', user.id)
      .maybeSingle<{ permissions: PermissionSet }>()
    if (permissionError) throw permissionError

    const token = await signSession({
      id: user.id,
      name: user.name ?? '',
      email: user.email,
      role: isRole(user.role) ? user.role : 'STAFF',
      warehouseId: user.warehouseId,
      permissions: permissionRecord?.permissions ?? {},
    })

    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('Login failed', error)
    return NextResponse.json({ error: 'Unable to sign in. Please try again.' }, { status: 500 })
  }
}
