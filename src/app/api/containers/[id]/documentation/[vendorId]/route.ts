import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { clearContainerDataCache } from '@/lib/containers/data'
import { createAdminClient } from '@/lib/supabase/admin'

const PAYMENT_TERMS = new Set(['NET_30', 'NET_60', 'NET_90', 'CASH'])

async function getPackage(containerNumber: string, vendorDocId: string) {
  const db = createAdminClient()
  const { data: vendor, error: vendorError } = await db
    .from('ContainerDocVendor')
    .select('id,entryId,status')
    .eq('id', vendorDocId)
    .maybeSingle()
  if (vendorError) throw vendorError
  if (!vendor) return null

  const { data: entry, error: entryError } = await db
    .from('ContainerDocEntry')
    .select('id,containerId,warehouseId')
    .eq('id', vendor.entryId)
    .maybeSingle()
  if (entryError) throw entryError
  if (!entry?.containerId) return null

  const { data: container, error: containerError } = await db
    .from('Container')
    .select('containerName')
    .eq('id', entry.containerId)
    .maybeSingle()
  if (containerError) throw containerError
  if (container?.containerName !== containerNumber) return null
  return { db, vendor, entry }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; vendorId: string }> }) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only administrators can review documentation and save costs.' }, { status: 403 })

  try {
    const { id: containerNumber, vendorId } = await context.params
    const packageData = await getPackage(containerNumber, vendorId)
    if (!packageData) return NextResponse.json({ error: 'Documentation package not found.' }, { status: 404 })
    const { db, vendor, entry } = packageData
    const body = await request.json()
    const action = String(body.action ?? '')
    const now = new Date().toISOString()

    if (action === 'approve' || action === 'reject') {
      if (action === 'approve' && body.isfConfirmed !== true) {
        return NextResponse.json({ error: 'Confirm the ISF filing before approving these documents.' }, { status: 400 })
      }
      const status = action === 'approve' ? 'REVIEWED' : 'DOCS_PENDING'
      const update = action === 'approve'
        ? { status, isfConfirmed: true, reviewedById: user.id, reviewedAt: now, reviewNotes: null, updatedAt: now }
        : { status, isfConfirmed: false, reviewedById: user.id, reviewedAt: now, reviewNotes: String(body.reviewNotes ?? 'Documents rejected by admin').trim(), updatedAt: now }
      const { data, error } = await db.from('ContainerDocVendor').update(update).eq('id', vendorId).select('*').single()
      if (error) throw error
      await db.from('ContainerDocActivity').insert({
        id: crypto.randomUUID(),
        entryId: entry.id,
        vendorDocId: vendorId,
        action: action === 'approve' ? 'DOCUMENTS_APPROVED' : 'DOCUMENTS_REJECTED',
        actor: user.name || user.email,
        details: { previousStatus: vendor.status, status, isfConfirmed: update.isfConfirmed, reviewNotes: update.reviewNotes },
        createdAt: now,
      })
      clearContainerDataCache()
      return NextResponse.json({ vendor: data })
    }

    if (action === 'save-cost') {
      const totalCost = Number(body.totalCost)
      const paymentTerms = String(body.paymentTerms ?? '')
      const paymentDueDate = String(body.paymentDueDate ?? '')
      if (!Number.isFinite(totalCost) || totalCost < 0) return NextResponse.json({ error: 'Enter a valid total cost.' }, { status: 400 })
      if (!PAYMENT_TERMS.has(paymentTerms)) return NextResponse.json({ error: 'Select valid payment terms.' }, { status: 400 })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDueDate)) return NextResponse.json({ error: 'Select a payment due date.' }, { status: 400 })

      const { data: existing, error: existingError } = await db.from('ContainerCost').select('id').eq('containerDocVendorId', vendorId).maybeSingle()
      if (existingError) throw existingError
      const values = {
        totalCost,
        paymentTerms,
        paymentDueDate: `${paymentDueDate}T00:00:00`,
        warehouseId: entry.warehouseId,
        addedById: user.id,
        updatedAt: now,
      }
      const result = existing
        ? await db.from('ContainerCost').update(values).eq('id', existing.id).select('*').single()
        : await db.from('ContainerCost').insert({ id: crypto.randomUUID(), containerDocVendorId: vendorId, ...values, isPaid: false, createdAt: now }).select('*').single()
      if (result.error) throw result.error
      await db.from('ContainerDocActivity').insert({
        id: crypto.randomUUID(),
        entryId: entry.id,
        vendorDocId: vendorId,
        action: 'COST_SAVED',
        actor: user.name || user.email,
        details: { totalCost, paymentTerms, paymentDueDate },
        createdAt: now,
      })
      clearContainerDataCache()
      return NextResponse.json({ cost: result.data })
    }

    return NextResponse.json({ error: 'Unsupported documentation action.' }, { status: 400 })
  } catch (error) {
    console.error('Container documentation update failed', error)
    return NextResponse.json({ error: 'Unable to update this documentation package.' }, { status: 500 })
  }
}
