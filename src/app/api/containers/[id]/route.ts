import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { getContainerDetail } from '@/lib/containers/data'

export async function GET(_request: Request, context: RouteContext<'/api/containers/[id]'>) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers')) return NextResponse.json({ error: 'You do not have access to Containers.' }, { status: 403 })
  try {
    const { id } = await context.params
    const container = await getContainerDetail(id)
    if (!container) return NextResponse.json({ error: 'Container not found.' }, { status: 404 })
    return NextResponse.json(container)
  } catch (error) {
    console.error('Container detail failed', error)
    return NextResponse.json({ error: 'Unable to load container details.' }, { status: 500 })
  }
}
