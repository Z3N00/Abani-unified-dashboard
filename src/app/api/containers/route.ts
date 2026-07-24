import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { getContainers } from '@/lib/containers/data'

export async function GET(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers')) return NextResponse.json({ error: 'You do not have access to Containers.' }, { status: 403 })
  try {
    const fresh = new URL(request.url).searchParams.get('refresh') === '1'
    return NextResponse.json(await getContainers({ fresh }))
  } catch (error) {
    console.error('Container list failed', error)
    return NextResponse.json({ error: 'Unable to load containers.' }, { status: 500 })
  }
}
