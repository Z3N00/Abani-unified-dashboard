import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const db = createAdminClient()
  const { data, error } = await db.from('EmailQueue').select('id,status,type,relatedId,relatedType').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return NextResponse.json({ error: 'Email not found.' }, { status: 404 })
  if (data.status !== 'queued') return NextResponse.json({ error: 'Only queued emails can be discarded.' }, { status: 409 })
  const now = new Date().toISOString()
  const { error: updateError } = await db.from('EmailQueue').update({ status: 'discarded', discardedAt: now, sentBy: user.id }).eq('id', id).eq('status', 'queued')
  if (updateError) throw updateError
  if (data.relatedType === 'ContainerDocEntry' && data.relatedId) {
    await db.from('ContainerDocActivity').insert({ entryId: data.relatedId, vendorDocId: null, action: 'EMAIL_DISCARDED', actor: user.email, details: { emailId: id, requestCancelled: data.type === 'overseas_doc_created' }, createdAt: now })
  }
  clearContainerDataCache()
  return NextResponse.json({ discarded: true })
}
