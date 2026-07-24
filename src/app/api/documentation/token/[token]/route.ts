import { NextResponse } from 'next/server'
import { clearContainerDataCache, getContainerDocumentationDetail } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

async function findEntry(token: string) {
  const db = createAdminClient()
  const { data, error } = await db.from('ContainerDocEntry').select('*').eq('photoToken', token).maybeSingle()
  if (error) throw error
  return { db, entry: data }
}

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const { entry } = await findEntry(token)
    if (!entry) return NextResponse.json({ error: 'Documentation link is invalid or expired.' }, { status: 404 })
    const detail = await getContainerDocumentationDetail(String(entry.id))
    return NextResponse.json({ detail })
  } catch (error) {
    console.error('Token documentation load failed', error)
    return NextResponse.json({ error: 'Unable to load the documentation request.' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const { db, entry } = await findEntry(token)
    if (!entry) return NextResponse.json({ error: 'Documentation link is invalid or expired.' }, { status: 404 })
    const body = await request.json()
    const action = String(body.action ?? '')
    const now = new Date().toISOString()

    if (action === 'set-container') {
      if (entry.isSubmitted) return NextResponse.json({ error: 'This documentation request has already been submitted.' }, { status: 409 })
      const containerNumber = String(body.containerNumber ?? '').trim().toUpperCase()
      if (!containerNumber) return NextResponse.json({ error: 'Enter the container number.' }, { status: 400 })
      const { data: containers, error: containerError } = await db.from('Container').select('id,containerName').ilike('containerName', containerNumber).limit(1)
      if (containerError) throw containerError
      const container = containers?.[0]
      if (!container) return NextResponse.json({ error: 'That container number was not found in SellerCloud container data.' }, { status: 404 })
      const { error } = await db.from('ContainerDocEntry').update({ containerId: container.id, containerNumber: container.containerName, updatedAt: now }).eq('id', entry.id)
      if (error) throw error
      await db.from('ContainerDocActivity').insert({ id: crypto.randomUUID(), entryId: entry.id, vendorDocId: null, action: 'CONTAINER_LINKED', actor: 'Overseas documentation link', details: { containerNumber: container.containerName }, createdAt: now })
    } else if (action === 'save-freight') {
      const freightCost = Number(body.freightCost)
      const freightForwarder = String(body.freightForwarder ?? '').trim()
      if (!Number.isFinite(freightCost) || freightCost < 0) return NextResponse.json({ error: 'Enter a valid freight cost.' }, { status: 400 })
      const { data: existing, error: existingError } = await db.from('ContainerDocFreight').select('id').eq('entryId', entry.id).maybeSingle()
      if (existingError) throw existingError
      const values = { freightCost, freightForwarder: freightForwarder || null, updatedAt: now }
      const result = existing
        ? await db.from('ContainerDocFreight').update(values).eq('id', existing.id)
        : await db.from('ContainerDocFreight').insert({ id: crypto.randomUUID(), entryId: entry.id, ...values, createdAt: now })
      if (result.error) throw result.error
      await db.from('ContainerDocEntry').update({ freightForwarder: freightForwarder || null, updatedAt: now }).eq('id', entry.id)
    } else if (action === 'submit') {
      if (!entry.containerId || !entry.containerNumber) return NextResponse.json({ error: 'Set the container number before submitting.' }, { status: 400 })
      const { data: vendors, error: vendorError } = await db.from('ContainerDocVendor').select('id').eq('entryId', entry.id)
      if (vendorError) throw vendorError
      const vendorIds = (vendors ?? []).map((vendor) => String(vendor.id))
      const { data: documents, error: documentsError } = vendorIds.length
        ? await db.from('ContainerDocument').select('containerDocVendorId,type').in('containerDocVendorId', vendorIds)
        : { data: [], error: null }
      if (documentsError) throw documentsError
      const required = ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_SLIP', 'ISF_FORM']
      const incomplete = vendorIds.filter((vendorId) => {
        const types = new Set((documents ?? []).filter((document) => document.containerDocVendorId === vendorId).map((document) => String(document.type)))
        return required.some((type) => !types.has(type))
      })
      if (incomplete.length) return NextResponse.json({ error: 'Upload all four required documents for every vendor before submitting.' }, { status: 400 })
      const { error: statusError } = await db.from('ContainerDocVendor').update({ status: 'DOCS_UPLOADED', updatedAt: now }).in('id', vendorIds)
      if (statusError) throw statusError
      const { error: submitError } = await db.from('ContainerDocEntry').update({ isSubmitted: true, submittedAt: now, updatedAt: now }).eq('id', entry.id)
      if (submitError) throw submitError
      await db.from('ContainerDocActivity').insert({ id: crypto.randomUUID(), entryId: entry.id, vendorDocId: null, action: 'DOCUMENTATION_SUBMITTED', actor: 'Overseas documentation link', details: { vendorCount: vendorIds.length }, createdAt: now })
    } else {
      return NextResponse.json({ error: 'Unsupported documentation action.' }, { status: 400 })
    }

    clearContainerDataCache()
    const detail = await getContainerDocumentationDetail(String(entry.id))
    return NextResponse.json({ detail })
  } catch (error) {
    console.error('Token documentation update failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update the documentation request.' }, { status: 500 })
  }
}
