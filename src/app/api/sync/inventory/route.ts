import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { hasAccess } from '@/lib/access-control'
import { fetchInventoryCacheBatch } from '@/lib/sellercloud/inventory'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearContainerDataCache } from '@/lib/containers/data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 250

function isScheduledRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

async function canSync(request: NextRequest) {
  if (isScheduledRequest(request)) return true
  const user = await getApiUser()
  return Boolean(user && hasAccess(user, 'containers.sync', 'write'))
}

async function syncInventory() {
  const supabase = createAdminClient()
  const { data: previousState } = await supabase.from('inventory_sync_state').select('next_page,records_synced').eq('source', 'sellercloud').maybeSingle()
  const startedAt = new Date().toISOString()
  await supabase.from('inventory_sync_state').upsert({ source: 'sellercloud', status: 'running', error_message: null, updated_at: startedAt }, { onConflict: 'source' })

  try {
    const startPage = Math.max(Number(previousState?.next_page) || 1, 1)
    const maxPages = Math.min(Math.max(Number(process.env.SELLERCLOUD_INVENTORY_BATCH_PAGES) || 10, 1), 20)
    const batch = await fetchInventoryCacheBatch(startPage, maxPages)
    const rows = batch.rows
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      const { error } = await supabase.from('inventory').upsert(rows.slice(start, start + CHUNK_SIZE), { onConflict: 'sku,warehouse' })
      if (error) throw new Error(`Could not save inventory: ${error.message}`)
    }
    const completedAt = new Date().toISOString()
    const totalSynced = batch.nextPage ? Number(previousState?.records_synced ?? 0) + rows.length : rows.length
    await supabase.from('inventory_sync_state').upsert({ source: 'sellercloud', status: batch.nextPage ? 'partial' : 'complete', completed_at: batch.nextPage ? null : completedAt, records_synced: totalSynced, next_page: batch.nextPage ?? 1, error_message: null, updated_at: completedAt }, { onConflict: 'source' })
    clearContainerDataCache()
    return NextResponse.json({ ok: true, recordsSynced: rows.length, nextPage: batch.nextPage, completedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inventory sync failed.'
    await supabase.from('inventory_sync_state').upsert({ source: 'sellercloud', status: 'failed', error_message: message, updated_at: new Date().toISOString() }, { onConflict: 'source' })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Vercel Cron invokes this secured GET endpoint on the production deployment. */
export async function GET(request: NextRequest) {
  if (!isScheduledRequest(request)) return NextResponse.json({ error: 'Not authorized to sync inventory.' }, { status: 403 })
  return syncInventory()
}

/** Allows an authorized administrator to run a one-off sync from the dashboard later. */
export async function POST(request: NextRequest) {
  if (!await canSync(request)) return NextResponse.json({ error: 'Not authorized to sync inventory.' }, { status: 403 })
  return syncInventory()
}
