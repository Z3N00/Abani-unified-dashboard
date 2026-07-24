import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const DOCUMENT_TYPES = new Set(['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_SLIP', 'ISF_FORM', 'OTHER', 'ARRIVAL_NOTICE'])

function safeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-')
  return cleaned || 'upload'
}

async function vendorBelongsToContainer(containerNumber: string, vendorId: string) {
  const db = createAdminClient()
  const { data: containers, error: containerError } = await db.from('Container').select('id').eq('containerName', containerNumber)
  if (containerError) throw containerError
  const containerIds = ((containers ?? []) as { id: string }[]).map((container) => String(container.id))
  if (!containerIds.length) return false

  const { data: entries, error: entryError } = await db.from('ContainerDocEntry').select('id').in('containerId', containerIds)
  if (entryError) throw entryError
  const entryIds = (entries ?? []).map((entry) => String(entry.id))
  if (!entryIds.length) return false

  const { data: vendor, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('id', vendorId).in('entryId', entryIds).maybeSingle()
  if (vendorError) throw vendorError
  return Boolean(vendor)
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'read') || !hasAccess(user, 'containers.documentation_upload', 'write')) {
    return NextResponse.json({ error: 'You do not have permission to upload container documents.' }, { status: 403 })
  }

  try {
    const { id: containerNumber } = await context.params
    const formData = await request.formData()
    const file = formData.get('file')
    const vendorId = String(formData.get('vendorId') ?? '')
    const kind = formData.get('kind') === 'departure-photo' ? 'departure-photo' : 'document'
    const documentType = String(formData.get('documentType') ?? 'OTHER')
    const caption = String(formData.get('caption') ?? '').trim()

    if (!(file instanceof File) || !vendorId) return NextResponse.json({ error: 'Select a file and its vendor documentation package.' }, { status: 400 })
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Only PDF, JPEG, PNG, and WebP files are supported.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Files must be 15 MB or smaller.' }, { status: 400 })
    if (kind === 'document' && !DOCUMENT_TYPES.has(documentType)) return NextResponse.json({ error: 'Invalid document type.' }, { status: 400 })
    if (!(await vendorBelongsToContainer(containerNumber, vendorId))) return NextResponse.json({ error: 'The selected documentation package does not belong to this container.' }, { status: 404 })

    const db = createAdminClient()
    const objectPath = `containers/${encodeURIComponent(containerNumber)}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const { error: storageError } = await db.storage.from('container-documents').upload(objectPath, file, { contentType: file.type, upsert: false })
    if (storageError) throw storageError

    const uploadDate = new Date().toISOString()
    const result = kind === 'departure-photo'
      ? await db.from('ContainerDeparturePhoto').insert({ containerDocVendorId: vendorId, fileName: file.name, fileUrl: objectPath, fileSize: file.size, caption: caption || null, uploadedById: user.id, uploadedAt: uploadDate }).select('*').single()
      : await db.from('ContainerDocument').insert({ containerDocVendorId: vendorId, type: documentType, fileName: file.name, fileUrl: objectPath, fileSize: file.size, uploadedById: user.id, uploadedAt: uploadDate }).select('*').single()
    const { data, error } = result
    if (error) {
      await db.storage.from('container-documents').remove([objectPath])
      throw error
    }
    return NextResponse.json({ file: data, kind }, { status: 201 })
  } catch (error) {
    console.error('Container document upload failed', error)
    return NextResponse.json({ error: 'Unable to upload the file.' }, { status: 500 })
  }
}
