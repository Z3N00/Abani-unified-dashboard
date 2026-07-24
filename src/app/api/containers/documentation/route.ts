import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache, getContainerDocumentation } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

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
    const input = await request.json() as { containerId?: unknown; freightForwarder?: unknown }
    const containerId = String(input.containerId ?? '').trim()
    const freightForwarder = String(input.freightForwarder ?? '').trim()
    if (!containerId) return NextResponse.json({ error: 'Choose a container first.' }, { status: 400 })

    const db = createAdminClient()
    const { data: selected, error: selectedError } = await db
      .from('Container')
      .select('id,containerName,shippedOn,shippingLine,portName,portOfDischarge,warehouseId')
      .eq('id', containerId)
      .maybeSingle()
    if (selectedError) throw selectedError
    if (!selected) return NextResponse.json({ error: 'The selected container no longer exists.' }, { status: 404 })

    const containerNumber = String(selected.containerName ?? '').trim()
    if (!containerNumber) return NextResponse.json({ error: 'The selected container has no container number.' }, { status: 400 })

    const { data: existing, error: existingError } = await db
      .from('ContainerDocEntry')
      .select('id')
      .eq('containerNumber', containerNumber)
      .limit(1)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) {
      return NextResponse.json({ error: 'A documentation entry already exists for this container.', entryId: existing.id }, { status: 409 })
    }

    const { data: linkedContainers, error: linkedError } = await db
      .from('Container')
      .select('id,vendorId')
      .eq('containerName', containerNumber)
      .limit(100)
    if (linkedError) throw linkedError
    const vendorIds = [...new Set((linkedContainers ?? []).map((row) => String(row.vendorId ?? '').trim()).filter(Boolean))]
    if (!vendorIds.length) {
      return NextResponse.json({ error: 'This container has no linked vendor, so its documentation entry cannot be created yet.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    createdEntryId = randomUUID()
    const { error: entryError } = await db.from('ContainerDocEntry').insert({
      id: createdEntryId,
      containerNumber,
      loadingDate: selected.shippedOn ?? null,
      shippingLine: selected.shippingLine ?? null,
      destinationPort: selected.portName ?? selected.portOfDischarge ?? null,
      containerId,
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
      freightForwarder: freightForwarder || null,
      warehouseId: selected.warehouseId ?? null,
      isSubmitted: false,
      arrivalNotice: false,
      isAutoCreated: false,
    })
    if (entryError) throw entryError

    const { error: vendorsError } = await db.from('ContainerDocVendor').insert(vendorIds.map((vendorId) => ({
      id: randomUUID(),
      entryId: createdEntryId,
      vendorId,
      status: 'DOCS_PENDING',
      createdAt: now,
      updatedAt: now,
      isfConfirmed: false,
    })))
    if (vendorsError) {
      await db.from('ContainerDocEntry').delete().eq('id', createdEntryId)
      createdEntryId = ''
      throw vendorsError
    }

    await db.from('ContainerDocActivity').insert({
      entryId: createdEntryId,
      vendorDocId: null,
      action: 'ENTRY_CREATED',
      actor: user.email,
      details: { containerNumber, vendorCount: vendorIds.length },
      createdAt: now,
    })
    clearContainerDataCache()
    return NextResponse.json({ entryId: createdEntryId }, { status: 201 })
  } catch (error) {
    console.error('Container documentation creation failed', error)
    return NextResponse.json({ error: 'Unable to create the documentation entry.' }, { status: 500 })
  }
}
