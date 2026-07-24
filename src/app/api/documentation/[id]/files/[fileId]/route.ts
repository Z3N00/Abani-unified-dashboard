import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>

export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getApiUser()
  try {
    const { id: entryId, fileId } = await context.params
    const search = new URL(request.url).searchParams
    const kind = search.get('kind')
    const token = search.get('token') ?? ''
    const db = createAdminClient()
    if (user) {
      if (!hasAccess(user, 'containers.documentation')) return NextResponse.json({ error: 'You do not have access to container documentation.' }, { status: 403 })
    } else {
      const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('id').eq('id', entryId).eq('photoToken', token).maybeSingle()
      if (entryError) throw entryError
      if (!entry) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    let file: Row | null = null

    if (kind === 'warehouse-photo') {
      const { data, error } = await db.from('ContainerWarehousePhoto').select('*').eq('id', fileId).eq('entryId', entryId).maybeSingle()
      if (error) throw error
      file = data as Row | null
    } else {
      const table = kind === 'photo' ? 'ContainerDeparturePhoto' : 'ContainerDocument'
      const { data, error } = await db.from(table).select('*').eq('id', fileId).maybeSingle()
      if (error) throw error
      file = data as Row | null
      if (file) {
        const { data: vendor, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('id', String(file.containerDocVendorId ?? '')).eq('entryId', entryId).maybeSingle()
        if (vendorError) throw vendorError
        if (!vendor) file = null
      }
    }
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 })

    const fileUrl = String(file.fileUrl ?? '')
    if (/^https?:\/\//i.test(fileUrl)) return NextResponse.redirect(fileUrl)
    const { data: signed, error: signedError } = await db.storage.from('container-documents').createSignedUrl(fileUrl, 60 * 10)
    if (signedError || !signed?.signedUrl) throw signedError ?? new Error('Could not create a file link.')
    return NextResponse.redirect(signed.signedUrl)
  } catch (error) {
    console.error('Documentation file access failed', error)
    return NextResponse.json({ error: 'Unable to open the requested file.' }, { status: 500 })
  }
}
