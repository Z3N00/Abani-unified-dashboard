import { NextResponse } from 'next/server'
import { clearContainerDataCache, getContainerDocumentationDetail } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const DOCUMENT_TYPES = new Set(['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_SLIP', 'ISF_FORM', 'OTHER', 'ARRIVAL_NOTICE'])
const DOCUMENT_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const WAREHOUSE_PHOTO_TYPES = new Set(['SEAL', 'OPENED', 'EMPTY', 'SIGNED_BOL'])

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-') || 'upload'
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const db = createAdminClient()
    const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('id,containerId,containerNumber,isSubmitted,overseasRepId').eq('photoToken', token).maybeSingle()
    if (entryError) throw entryError
    if (!entry) return NextResponse.json({ error: 'Documentation link is invalid or expired.' }, { status: 404 })
    if (!entry.containerId || !entry.containerNumber) return NextResponse.json({ error: 'Set the container number before uploading files.' }, { status: 400 })
    if (entry.isSubmitted) return NextResponse.json({ error: 'This request has already been submitted.' }, { status: 409 })

    const formData = await request.formData()
    const file = formData.get('file')
    const vendorId = String(formData.get('vendorId') ?? '')
    const requestedKind = String(formData.get('kind') ?? 'document')
    const kind = requestedKind === 'departure-photo' || requestedKind === 'warehouse-photo' ? requestedKind : 'document'
    const documentType = String(formData.get('documentType') ?? 'OTHER')
    const photoType = String(formData.get('photoType') ?? '')
    const caption = String(formData.get('caption') ?? '').trim()
    if (!(file instanceof File) || !vendorId) return NextResponse.json({ error: 'Choose a file and vendor package.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Files must be 15 MB or smaller.' }, { status: 400 })
    if (kind === 'document' && (!DOCUMENT_TYPES.has(documentType) || !DOCUMENT_MIMES.has(file.type))) return NextResponse.json({ error: 'Choose a supported PDF, Excel, or image document.' }, { status: 400 })
    if (kind === 'departure-photo' && !PHOTO_MIMES.has(file.type)) return NextResponse.json({ error: 'Departure photos must be JPEG, PNG, or WebP.' }, { status: 400 })
    if (kind === 'warehouse-photo' && (!WAREHOUSE_PHOTO_TYPES.has(photoType) || !PHOTO_MIMES.has(file.type))) return NextResponse.json({ error: 'Choose a valid warehouse arrival slot and a JPEG, PNG, or WebP image.' }, { status: 400 })
    const { data: vendor, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('id', vendorId).eq('entryId', entry.id).maybeSingle()
    if (vendorError) throw vendorError
    if (!vendor) return NextResponse.json({ error: 'Vendor package not found.' }, { status: 404 })

    const objectPath = `containers/${encodeURIComponent(entry.containerNumber)}/${kind === 'warehouse-photo' ? 'warehouse/' : ''}${crypto.randomUUID()}-${safeFileName(file.name)}`
    const { error: storageError } = await db.storage.from('container-documents').upload(objectPath, file, { contentType: file.type, upsert: false })
    if (storageError) throw storageError
    const now = new Date().toISOString()
    let previousStoragePath = ''
    let result
    if (kind === 'warehouse-photo') {
      const { data: existing, error: existingError } = await db.from('ContainerWarehousePhoto').select('id,fileUrl').eq('entryId', entry.id).eq('type', photoType).maybeSingle()
      if (existingError) throw existingError
      previousStoragePath = String(existing?.fileUrl ?? '')
      const values = { entryId: entry.id, containerDocVendorId: vendorId, type: photoType, fileName: file.name, fileUrl: objectPath, fileSize: file.size, uploadedById: entry.overseasRepId, uploadedByName: 'Overseas documentation link', uploadedAt: now }
      result = existing
        ? await db.from('ContainerWarehousePhoto').update(values).eq('id', existing.id).select('*').single()
        : await db.from('ContainerWarehousePhoto').insert({ id: crypto.randomUUID(), ...values }).select('*').single()
    } else {
      result = kind === 'departure-photo'
        ? await db.from('ContainerDeparturePhoto').insert({ id: crypto.randomUUID(), containerDocVendorId: vendorId, fileName: file.name, fileUrl: objectPath, fileSize: file.size, caption: caption || null, uploadedById: entry.overseasRepId, uploadedAt: now }).select('*').single()
        : await db.from('ContainerDocument').insert({ id: crypto.randomUUID(), containerDocVendorId: vendorId, type: documentType, fileName: file.name, fileUrl: objectPath, fileSize: file.size, uploadedById: entry.overseasRepId, uploadedAt: now }).select('*').single()
    }
    if (result.error) {
      await db.storage.from('container-documents').remove([objectPath])
      throw result.error
    }
    if (previousStoragePath && !/^https?:\/\//i.test(previousStoragePath)) await db.storage.from('container-documents').remove([previousStoragePath])
    const action = kind === 'document' ? 'DOCUMENT_UPLOADED' : kind === 'departure-photo' ? 'DEPARTURE_PHOTO_UPLOADED' : 'WAREHOUSE_PHOTO_UPLOADED'
    await db.from('ContainerDocActivity').insert({ id: crypto.randomUUID(), entryId: entry.id, vendorDocId: vendorId, action, actor: 'Overseas documentation link', details: { fileName: file.name, documentType: kind === 'document' ? documentType : null, photoType: kind === 'warehouse-photo' ? photoType : null }, createdAt: now })
    clearContainerDataCache()
    const detail = await getContainerDocumentationDetail(String(entry.id))
    return NextResponse.json({ detail, file: result.data }, { status: 201 })
  } catch (error) {
    console.error('Token documentation upload failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to upload the file.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const db = createAdminClient()
    const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('id,isSubmitted').eq('photoToken', token).maybeSingle()
    if (entryError) throw entryError
    if (!entry) return NextResponse.json({ error: 'Documentation link is invalid or expired.' }, { status: 404 })
    if (entry.isSubmitted) return NextResponse.json({ error: 'This request has already been submitted.' }, { status: 409 })
    const photoId = new URL(request.url).searchParams.get('photoId') ?? ''
    const { data: photo, error: photoError } = await db.from('ContainerWarehousePhoto').select('id,fileUrl').eq('id', photoId).eq('entryId', entry.id).maybeSingle()
    if (photoError) throw photoError
    if (!photo) {
      clearContainerDataCache()
      return NextResponse.json({ detail: await getContainerDocumentationDetail(String(entry.id)), alreadyRemoved: true })
    }
    const { error: deleteError } = await db.from('ContainerWarehousePhoto').delete().eq('id', photo.id)
    if (deleteError) throw deleteError
    if (photo.fileUrl && !/^https?:\/\//i.test(photo.fileUrl)) await db.storage.from('container-documents').remove([photo.fileUrl])
    clearContainerDataCache()
    return NextResponse.json({ detail: await getContainerDocumentationDetail(String(entry.id)) })
  } catch (error) {
    console.error('Token warehouse photo removal failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to remove the warehouse arrival photo.' }, { status: 500 })
  }
}
