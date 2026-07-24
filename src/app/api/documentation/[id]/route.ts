import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache, getContainerDocumentationDetail } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

const EDITABLE_FIELDS = ['loadingDate', 'shippingLine', 'destinationPort', 'freightForwarder', 'warehouseId', 'overseasRepId'] as const

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'write')) return NextResponse.json({ error: 'You do not have permission to edit container documentation.' }, { status: 403 })

  try {
    const { id } = await context.params
    const input = await request.json() as Record<string, unknown>
    const update: Record<string, string | null> = {}
    for (const field of EDITABLE_FIELDS) {
      if (!(field in input)) continue
      const value = String(input[field] ?? '').trim()
      update[field] = value || null
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'No editable fields were provided.' }, { status: 400 })

    const db = createAdminClient()
    const { error } = await db.from('ContainerDocEntry').update({ ...update, updatedAt: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    await db.from('ContainerDocActivity').insert({ entryId: id, vendorDocId: null, action: 'ENTRY_UPDATED', actor: user.email, details: { fields: Object.keys(update) }, createdAt: new Date().toISOString() })
    clearContainerDataCache()
    const detail = await getContainerDocumentationDetail(id)
    if (!detail) return NextResponse.json({ error: 'Documentation entry not found.' }, { status: 404 })
    return NextResponse.json({ detail })
  } catch (error) {
    console.error('Documentation update failed', error)
    return NextResponse.json({ error: 'Unable to update container documentation.' }, { status: 500 })
  }
}
