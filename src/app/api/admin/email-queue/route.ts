import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const user = await getApiUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const status = new URL(request.url).searchParams.get('status') || 'queued'
  if (!['queued', 'sent', 'discarded'].includes(status)) return NextResponse.json({ error: 'Invalid queue status.' }, { status: 400 })
  const { data, error } = await createAdminClient()
    .from('EmailQueue')
    .select('id,to,toName,subject,body,type,relatedId,relatedType,status,queuedAt,sentAt,discardedAt,sentBy')
    .eq('status', status)
    .order(status === 'queued' ? 'queuedAt' : status === 'sent' ? 'sentAt' : 'discardedAt', { ascending: false })
    .limit(500)
  if (error) {
    console.error('Email queue list failed', error)
    return NextResponse.json({ error: 'Unable to load the email queue.' }, { status: 500 })
  }
  return NextResponse.json({ emails: data ?? [] })
}
