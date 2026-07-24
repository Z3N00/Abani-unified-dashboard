import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { hasAccess } from '@/lib/access-control'
import { clearContainerDataCache, getContainerDetail } from '@/lib/containers/data'
import { fetchInventoryForProducts } from '@/lib/sellercloud/inventory'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 250

function value(row: Record<string, unknown>, key: string) {
  return String(row[key] ?? '').trim()
}

function normalizeSku(value: string) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase()
}

export async function POST(_request: Request, context: RouteContext<'/api/sync/inventory/container/[id]'>) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.sync', 'write')) return NextResponse.json({ error: 'You do not have permission to sync Sellercloud inventory.' }, { status: 403 })

  try {
    const { id } = await context.params
    const detail = await getContainerDetail(id)
    if (!detail) return NextResponse.json({ error: 'Container not found.' }, { status: 404 })

    const productNames = new Map<string, string>()
    for (const item of detail.items) {
      const sku = normalizeSku(value(item, 'sku'))
      if (sku) productNames.set(sku, value(item, 'productName'))
    }
    const skus = [...productNames.keys()]
    if (!skus.length) return NextResponse.json({ error: 'This container has no Sellercloud SKUs to sync.' }, { status: 400 })

    const rows = (await fetchInventoryForProducts(skus)).map((row) => ({
      ...row,
      product_name: row.product_name || productNames.get(row.sku) || row.sku,
    }))
    const supabase = createAdminClient()
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      const { error } = await supabase.from('inventory').upsert(rows.slice(start, start + CHUNK_SIZE), { onConflict: 'sku,warehouse' })
      if (error) throw new Error(`Could not save inventory: ${error.message}`)
    }

    clearContainerDataCache()
    const refreshed = await getContainerDetail(id)
    return NextResponse.json({
      ok: true,
      productsSynced: skus.length,
      recordsSynced: rows.length,
      priorityRestock: refreshed?.priorityRestock ?? [],
      inventorySyncedAt: refreshed?.inventorySyncedAt ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Container inventory sync failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
