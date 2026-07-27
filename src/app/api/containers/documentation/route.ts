import { NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'node:crypto'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache, getContainerDocumentation } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

function value(input: unknown) {
  return typeof input === 'string' ? input.trim() : ''
}

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!)
}

export async function GET(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation')) return NextResponse.json({ error: 'You do not have access to container documentation.' }, { status: 403 })
  try {
    const fresh = new URL(request.url).searchParams.get('refresh') === '1'
    return NextResponse.json({ documentation: await getContainerDocumentation({ fresh }) })
  } catch (error) {
    console.error('Container documentation list failed', error)
    return NextResponse.json({ error: 'Unable to load container documentation.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'write')) {
    return NextResponse.json({ error: 'You do not have permission to create documentation entries.' }, { status: 403 })
  }

  let createdEntryId = ''
  try {
    const input = await request.json() as Record<string, unknown>
    const vendorIds = [...new Set(Array.isArray(input.vendorIds) ? input.vendorIds.map(value).filter(Boolean) : [])]
    const warehouseId = value(input.warehouseId)
    const overseasRepId = value(input.overseasRepId)
    const loadingDate = value(input.loadingDate)
    const shippingLine = value(input.shippingLine)
    const destinationPort = value(input.destinationPort)
    const freightForwarder = value(input.freightForwarder)

    if (!vendorIds.length) return NextResponse.json({ error: 'Select at least one vendor.' }, { status: 400 })
    if (!warehouseId) return NextResponse.json({ error: 'Select a warehouse.' }, { status: 400 })
    if (!overseasRepId) return NextResponse.json({ error: 'Select an overseas representative.' }, { status: 400 })
    if (!loadingDate) return NextResponse.json({ error: 'Choose a loading date.' }, { status: 400 })
    if (!shippingLine) return NextResponse.json({ error: 'Enter the shipping line.' }, { status: 400 })
    if (!destinationPort) return NextResponse.json({ error: 'Enter the destination port.' }, { status: 400 })

    const db = createAdminClient()
    const [vendorResult, warehouseResult, representativeResult] = await Promise.all([
      db.from('Vendor').select('id,name').in('id', vendorIds),
      db.from('Warehouse').select('id,name').eq('id', warehouseId).maybeSingle(),
      db.from('User').select('id,name,email,role').eq('id', overseasRepId).maybeSingle(),
    ])
    if (vendorResult.error) throw vendorResult.error
    if (warehouseResult.error) throw warehouseResult.error
    if (representativeResult.error) throw representativeResult.error
    if ((vendorResult.data ?? []).length !== vendorIds.length) return NextResponse.json({ error: 'One or more selected vendors no longer exist.' }, { status: 400 })
    if (!warehouseResult.data) return NextResponse.json({ error: 'The selected warehouse no longer exists.' }, { status: 400 })
    const representative = representativeResult.data
    if (!representative || !['OVERSEAS', 'OVERSEAS_REP'].includes(String(representative.role))) {
      return NextResponse.json({ error: 'Select a valid overseas representative.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const photoToken = randomBytes(32).toString('base64url')
    createdEntryId = randomUUID()
    const { error: entryError } = await db.from('ContainerDocEntry').insert({
      id: createdEntryId,
      containerNumber: null,
      containerId: null,
      loadingDate,
      shippingLine: shippingLine || null,
      destinationPort: destinationPort || null,
      freightForwarder: freightForwarder || null,
      warehouseId,
      overseasRepId,
      photoToken,
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
      isSubmitted: false,
      submittedAt: null,
      arrivalNotice: false,
      isAutoCreated: false,
    })
    if (entryError) throw entryError

    const vendorRows = vendorIds.map((vendorId) => ({
      id: randomUUID(),
      entryId: createdEntryId,
      vendorId,
      status: 'DOCS_PENDING',
      createdAt: now,
      updatedAt: now,
      isfConfirmed: false,
    }))
    const { error: vendorsError } = await db.from('ContainerDocVendor').insert(vendorRows)
    if (vendorsError) throw vendorsError

    const vendorNames = (vendorResult.data ?? []).map((vendor) => String(vendor.name)).sort()
    const configuredBaseUrl = value(process.env.APP_BASE_URL)
    const origin = configuredBaseUrl || new URL(request.url).origin
    const uploadUrl = `${origin.replace(/\/$/, '')}/containers/docs/${photoToken}`
    const subject = `New container documentation needed — ${vendorNames.join(', ')} loading ${loadingDate}`
    const body = [
      `<p>Hello ${escapeHtml(String(representative.name || 'there'))},</p>`,
      `<p>A new container documentation request has been created for <strong>${escapeHtml(vendorNames.join(', '))}</strong>.</p>`,
      `<p>Loading date: <strong>${escapeHtml(loadingDate)}</strong><br>Warehouse: <strong>${escapeHtml(String(warehouseResult.data.name))}</strong></p>`,
      '<p>Use the secure link below to enter the container number, upload the Commercial Invoice, Bill of Lading, Packing Slip, and ISF Form for each vendor, add freight information, and submit the request.</p>',
      `<p><a href="${escapeHtml(uploadUrl)}">Open documentation request</a></p>`,
    ].join('')
    const { error: emailError } = await db.from('EmailQueue').insert({
      id: randomUUID(),
      to: representative.email,
      toName: representative.name || null,
      subject,
      body,
      type: 'overseas_doc_created',
      relatedId: createdEntryId,
      relatedType: 'ContainerDocEntry',
      status: 'queued',
      queuedAt: now,
      sentAt: null,
      discardedAt: null,
      sentBy: null,
    })
    if (emailError) throw emailError

    await db.from('ContainerDocActivity').insert({
      id: randomUUID(),
      entryId: createdEntryId,
      vendorDocId: null,
      action: 'ENTRY_CREATED',
      actor: user.email,
      details: { vendorCount: vendorIds.length, warehouseId, overseasRepId, emailQueued: true },
      createdAt: now,
    })
    clearContainerDataCache()
    return NextResponse.json({ entryId: createdEntryId, emailQueued: true }, { status: 201 })
  } catch (error) {
    console.error('Container documentation creation failed', error)
    if (createdEntryId) {
      const db = createAdminClient()
      await db.from('EmailQueue').delete().eq('relatedId', createdEntryId)
      await db.from('ContainerDocVendor').delete().eq('entryId', createdEntryId)
      await db.from('ContainerDocEntry').delete().eq('id', createdEntryId)
    }
    return NextResponse.json({ error: 'Unable to create the documentation entry.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only administrators can delete pending documentation entries.' }, { status: 403 })

  try {
    const entryId = new URL(request.url).searchParams.get('id') ?? ''
    if (!entryId) return NextResponse.json({ error: 'Documentation entry ID is required.' }, { status: 400 })
    const db = createAdminClient()
    const { data: entry, error: entryError } = await db.from('ContainerDocEntry').select('id,containerId,containerNumber').eq('id', entryId).maybeSingle()
    if (entryError) throw entryError
    if (!entry) return NextResponse.json({ error: 'Documentation entry not found.' }, { status: 404 })
    if (entry.containerId || entry.containerNumber) {
      return NextResponse.json({ error: 'Linked documentation entries cannot be deleted.' }, { status: 409 })
    }

    const { data: vendors, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('entryId', entryId)
    if (vendorError) throw vendorError
    const vendorIds = (vendors ?? []).map((vendor) => String(vendor.id))
    const [documentsResult, departureResult, warehouseResult] = await Promise.all([
      vendorIds.length ? db.from('ContainerDocument').select('fileUrl').in('containerDocVendorId', vendorIds) : Promise.resolve({ data: [], error: null }),
      vendorIds.length ? db.from('ContainerDeparturePhoto').select('fileUrl').in('containerDocVendorId', vendorIds) : Promise.resolve({ data: [], error: null }),
      db.from('ContainerWarehousePhoto').select('fileUrl').eq('entryId', entryId),
    ])
    for (const result of [documentsResult, departureResult, warehouseResult]) if (result.error) throw result.error

    if (vendorIds.length) {
      for (const table of ['ContainerDocument', 'ContainerDeparturePhoto', 'ContainerCost']) {
        const { error } = await db.from(table).delete().in('containerDocVendorId', vendorIds)
        if (error) throw error
      }
    }
    for (const table of ['ContainerWarehousePhoto', 'ContainerDocFreight', 'ContainerDocActivity']) {
      const { error } = await db.from(table).delete().eq('entryId', entryId)
      if (error) throw error
    }
    const { error: emailError } = await db.from('EmailQueue').delete().eq('relatedId', entryId).eq('relatedType', 'ContainerDocEntry')
    if (emailError) throw emailError
    const { error: vendorsError } = await db.from('ContainerDocVendor').delete().eq('entryId', entryId)
    if (vendorsError) throw vendorsError
    const { error: deleteEntryError } = await db.from('ContainerDocEntry').delete().eq('id', entryId)
    if (deleteEntryError) throw deleteEntryError

    const storagePaths = [...(documentsResult.data ?? []), ...(departureResult.data ?? []), ...(warehouseResult.data ?? [])]
      .map((file) => String(file.fileUrl ?? ''))
      .filter((path) => path && !/^https?:\/\//i.test(path))
    if (storagePaths.length) await db.storage.from('container-documents').remove(storagePaths)
    clearContainerDataCache()
    return NextResponse.json({ deleted: entryId })
  } catch (error) {
    console.error('Pending documentation deletion failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete the documentation entry.' }, { status: 500 })
  }
}
