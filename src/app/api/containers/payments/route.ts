import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { getContainerPayments } from '@/lib/containers/data'

export async function GET(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.payments')) return NextResponse.json({ error: 'You do not have access to container payments.' }, { status: 403 })
  try {
    const fresh = new URL(request.url).searchParams.get('refresh') === '1'
    return NextResponse.json({ payments: await getContainerPayments({ fresh }) })
  } catch (error) {
    console.error('Container payments list failed', error)
    return NextResponse.json({ error: 'Unable to load container payments.' }, { status: 500 })
  }
}
