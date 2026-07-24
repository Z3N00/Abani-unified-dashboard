import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>

async function belongsToContainer(containerNumber: string, vendorId: string) {
  const db = createAdminClient()
  const { data: containers, error: containerError } = await db.from('Container').select('id').eq('containerName', containerNumber)
  if (containerError) throw containerError
  const containerIds = ((containers ?? []) as { id: string }[]).map((container) => String(container.id))
  if (!containerIds.length) return false
  const { data: entries, error: entryError } = await db.from('ContainerDocEntry').select('id').in('containerId', containerIds)
  if (entryError) throw entryError
  const entryIds = (entries ?? []).map((entry) => String(entry.id))
  if (!entryIds.length) return false
  const { data, error } = await db.from('ContainerDocVendor').select('id').eq('id', vendorId).in('entryId', entryIds).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'read')) return NextResponse.json({ error: 'You do not have access to container documentation.' }, { status: 403 })

  try {
    const { id: containerNumber, fileId } = await context.params
    const kind = new URL(request.url).searchParams.get('kind') === 'photo' ? 'photo' : 'document'
    const db = createAdminClient()
    const table = kind === 'photo' ? 'ContainerDeparturePhoto' : 'ContainerDocument'
    const { data, error } = await db.from(table).select('*').eq('id', fileId).maybeSingle()
    if (error) throw error
    const file = data as Row | null
    if (!file || !(await belongsToContainer(containerNumber, String(file.containerDocVendorId ?? '')))) return NextResponse.json({ error: 'File not found.' }, { status: 404 })

    const fileUrl = String(file.fileUrl ?? '')
    if (/^https?:\/\//i.test(fileUrl)) return NextResponse.redirect(fileUrl)
    const { data: signed, error: signedError } = await db.storage.from('container-documents').createSignedUrl(fileUrl, 60 * 10)
    if (signedError || !signed?.signedUrl) throw signedError ?? new Error('Could not create a download link.')
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    console.error('Container document access failed', error)
    return NextResponse.json({ error: 'Unable to open the requested file.' }, { status: 500 })
  }
}
