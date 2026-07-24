import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'write')) return NextResponse.json({ error: 'You do not have permission to resend documentation emails.' }, { status: 403 })

  try {
    const { id } = await context.params
    const db = createAdminClient()
    const { data: entryData, error: entryError } = await db.from('ContainerDocEntry').select('id,containerNumber,loadingDate,destinationPort,shippingLine,overseasRepId').eq('id', id).maybeSingle()
    if (entryError) throw entryError
    if (!entryData) return NextResponse.json({ error: 'Documentation entry not found.' }, { status: 404 })
    const entry = entryData as Row

    const [{ data: previousData, error: previousError }, { data: repData, error: repError }, { data: vendorLinks, error: vendorLinkError }] = await Promise.all([
      db.from('EmailQueue').select('to,toName,subject,body,type').eq('relatedId', id).order('queuedAt', { ascending: false }).limit(1),
      entry.overseasRepId ? db.from('User').select('name,email').eq('id', String(entry.overseasRepId)).maybeSingle() : Promise.resolve({ data: null, error: null }),
      db.from('ContainerDocVendor').select('vendorId').eq('entryId', id),
    ])
    if (previousError || repError || vendorLinkError) throw previousError || repError || vendorLinkError
    const previous = ((previousData ?? []) as Row[])[0]
    const vendorIds = ((vendorLinks ?? []) as Row[]).map((vendor) => String(vendor.vendorId ?? '')).filter(Boolean)
    const { data: vendorData, error: vendorError } = vendorIds.length ? await db.from('Vendor').select('name').in('id', vendorIds) : { data: [], error: null }
    if (vendorError) throw vendorError
    const vendorNames = ((vendorData ?? []) as Row[]).map((vendor) => String(vendor.name ?? '')).filter(Boolean).join(', ')
    const recipientEmail = String(previous?.to ?? (repData as Row | null)?.email ?? '')
    const recipientName = String(previous?.toName ?? (repData as Row | null)?.name ?? '')
    if (!recipientEmail) return NextResponse.json({ error: 'This entry has no overseas representative email address.' }, { status: 400 })

    const containerNumber = String(entry.containerNumber ?? 'Container')
    const loadingDate = entry.loadingDate ? new Date(String(entry.loadingDate)).toLocaleDateString('en-US') : 'not specified'
    const subject = String(previous?.subject ?? `Docs Reminder: ${containerNumber} - ${String(entry.destinationPort ?? '')} - ${loadingDate}`)
    const body = String(previous?.body ?? `<p>Hello ${recipientName || 'team'},</p><p>This is a reminder to complete the documentation for container <strong>${containerNumber}</strong>${vendorNames ? ` (${vendorNames})` : ''}, loading ${loadingDate}.</p><p>Please sign in to the Abani Rugs operations dashboard to review the outstanding documentation.</p>`)
    const queuedAt = new Date().toISOString()
    const { error: queueError } = await db.from('EmailQueue').insert({ to: recipientEmail, toName: recipientName || null, subject, body, type: String(previous?.type ?? 'overseas_doc_reminder'), relatedId: id, relatedType: 'ContainerDocEntry', status: 'queued', queuedAt, sentAt: null, discardedAt: null, sentBy: user.id })
    if (queueError) throw queueError
    await db.from('ContainerDocActivity').insert({ entryId: id, vendorDocId: null, action: 'EMAIL_RESENT', actor: user.email, details: { to: recipientEmail, subject }, createdAt: queuedAt })
    return NextResponse.json({ message: `Documentation email queued for ${recipientName || recipientEmail}.` })
  } catch (error) {
    console.error('Documentation email resend failed', error)
    return NextResponse.json({ error: 'Unable to queue the documentation email.' }, { status: 500 })
  }
}
