import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { sendQueuedEmail } from '@/lib/email/smtp'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const db = createAdminClient()
  const { data, error } = await db.from('EmailQueue').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return NextResponse.json({ error: 'Email not found.' }, { status: 404 })
  if (data.status !== 'queued') return NextResponse.json({ error: 'Only queued emails can be sent.' }, { status: 409 })
  try {
    await sendQueuedEmail({ to: String(data.to), subject: String(data.subject), html: String(data.body) })
    const now = new Date().toISOString()
    const { error: updateError } = await db.from('EmailQueue').update({ status: 'sent', sentAt: now, sentBy: user.id }).eq('id', id).eq('status', 'queued')
    if (updateError) throw updateError
    if (data.relatedType === 'ContainerDocEntry' && data.relatedId) {
      await db.from('ContainerDocActivity').insert({ entryId: data.relatedId, vendorDocId: null, action: 'EMAIL_SENT', actor: user.email, details: { emailId: id, to: data.to }, createdAt: now })
    }
    return NextResponse.json({ sent: true })
  } catch (sendError) {
    console.error('Queued email send failed', sendError)
    const message = sendError instanceof Error && sendError.message.includes('SMTP_')
      ? 'SMTP is not configured on this deployment.'
      : 'The email could not be sent. It remains queued.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
