import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

const PHOTO_TYPES = new Set(['SEAL', 'OPENED', 'EMPTY', 'SIGNED_BOL'])
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 15 * 1024 * 1024

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-') || 'warehouse-photo'
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'read') || !hasAccess(user, 'containers.documentation_upload', 'write')) {
    return NextResponse.json({ error: 'You do not have permission to upload warehouse arrival photos.' }, { status: 403 })
  }

  try {
    const { id: containerNumber } = await context.params
    const formData = await request.formData()
    const file = formData.get('file')
    const entryId = String(formData.get('entryId') ?? '')
    const vendorId = String(formData.get('vendorId') ?? '')
    const photoType = String(formData.get('photoType') ?? '')
    if (!(file instanceof File) || !entryId || !vendorId || !PHOTO_TYPES.has(photoType)) return NextResponse.json({ error: 'Choose a vendor warehouse-photo slot and image.' }, { status: 400 })
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Warehouse photos must be JPEG, PNG, or WebP.' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Photos must be 15 MB or smaller.' }, { status: 400 })

    const db = createAdminClient()
    const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('id,containerId').eq('id', entryId).maybeSingle()
    if (entryError) throw entryError
    if (!entry?.containerId) return NextResponse.json({ error: 'Documentation entry not found.' }, { status: 404 })
    const { data: container, error: containerError } = await db.from('Container').select('containerName').eq('id', entry.containerId).maybeSingle()
    if (containerError) throw containerError
    if (container?.containerName !== containerNumber) return NextResponse.json({ error: 'This documentation entry does not belong to the selected container.' }, { status: 404 })
    const { data: vendorPackage, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('id', vendorId).eq('entryId', entryId).maybeSingle()
    if (vendorError) throw vendorError
    if (!vendorPackage) return NextResponse.json({ error: 'This vendor package does not belong to the selected documentation entry.' }, { status: 404 })

    const objectPath = `containers/${encodeURIComponent(containerNumber)}/warehouse/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const { error: storageError } = await db.storage.from('container-documents').upload(objectPath, file, { contentType: file.type, upsert: false })
    if (storageError) throw storageError

    const { data: existingRows, error: existingError } = await db.from('ContainerWarehousePhoto').select('id,fileUrl').eq('containerDocVendorId', vendorId).eq('type', photoType).order('uploadedAt', { ascending: false }).limit(1)
    if (existingError) {
      await db.storage.from('container-documents').remove([objectPath])
      throw existingError
    }
    const existing = existingRows?.[0] ?? null
    const now = new Date().toISOString()
    const values = { entryId, containerDocVendorId: vendorId, type: photoType, fileName: file.name, fileUrl: objectPath, fileSize: file.size, uploadedById: user.id, uploadedByName: user.name || user.email, uploadedAt: now }
    const result = existing
      ? await db.from('ContainerWarehousePhoto').update(values).eq('id', existing.id).select('*').single()
      : await db.from('ContainerWarehousePhoto').insert({ id: crypto.randomUUID(), ...values }).select('*').single()
    if (result.error) {
      await db.storage.from('container-documents').remove([objectPath])
      throw result.error
    }
    if (existing?.fileUrl && !/^https?:\/\//i.test(existing.fileUrl)) await db.storage.from('container-documents').remove([existing.fileUrl])
    clearContainerDataCache()
    return NextResponse.json({ photo: result.data }, { status: existing ? 200 : 201 })
  } catch (error) {
    console.error('Warehouse arrival photo upload failed', error)
    return NextResponse.json({ error: 'Unable to upload the warehouse arrival photo.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'read') || !hasAccess(user, 'containers.documentation_upload', 'write')) {
    return NextResponse.json({ error: 'You do not have permission to remove warehouse arrival photos.' }, { status: 403 })
  }

  try {
    const { id: containerNumber } = await context.params
    const search = new URL(request.url).searchParams
    const photoId = search.get('photoId') ?? ''
    const db = createAdminClient()
    const { data: photo, error: photoError } = await db.from('ContainerWarehousePhoto').select('id,entryId,containerDocVendorId,type,fileUrl').eq('id', photoId).maybeSingle()
    if (photoError) throw photoError
    if (!photo) {
      // Treat repeated removal as success so a stale Vercel/client cache can
      // discard a card whose database row and storage object are already gone.
      clearContainerDataCache()
      return NextResponse.json({ removed: [photoId], alreadyRemoved: true })
    }
    const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('containerId').eq('id', photo.entryId).maybeSingle()
    if (entryError) throw entryError
    const { data: container, error: containerError } = entry?.containerId
      ? await db.from('Container').select('containerName').eq('id', entry.containerId).maybeSingle()
      : { data: null, error: null }
    if (containerError) throw containerError
    if (container?.containerName !== containerNumber) return NextResponse.json({ error: 'Warehouse photo not found.' }, { status: 404 })
    const { data: slotPhotos, error: slotError } = await db.from('ContainerWarehousePhoto').select('id,fileUrl').eq('containerDocVendorId', photo.containerDocVendorId).eq('type', photo.type)
    if (slotError) throw slotError
    const { error: deleteError } = await db.from('ContainerWarehousePhoto').delete().eq('containerDocVendorId', photo.containerDocVendorId).eq('type', photo.type)
    if (deleteError) throw deleteError
    const storagePaths = (slotPhotos ?? []).map((row) => String(row.fileUrl ?? '')).filter((path) => path && !/^https?:\/\//i.test(path))
    if (storagePaths.length) await db.storage.from('container-documents').remove(storagePaths)
    clearContainerDataCache()
    return NextResponse.json({ removed: (slotPhotos ?? []).map((row) => row.id), type: photo.type })
  } catch (error) {
    console.error('Warehouse arrival photo removal failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to remove the warehouse arrival photo.' }, { status: 500 })
  }
}
