import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(user, 'containers.documentation', 'write')) {
    return NextResponse.json({ error: 'You do not have permission to create documentation entries.' }, { status: 403 })
  }

  try {
    const db = createAdminClient()
    const [vendors, warehouses, representatives] = await Promise.all([
      db.from('Vendor').select('id,name').order('name', { ascending: true }).limit(500),
      db.from('Warehouse').select('id,name').order('name', { ascending: true }).limit(100),
      // The production UserRole enum still calls this role OVERSEAS. The
      // application-facing OVERSEAS_REP name will be introduced later.
      db.from('User').select('id,name,email,role').eq('role', 'OVERSEAS').order('name', { ascending: true }).limit(100),
    ])
    if (vendors.error) throw vendors.error
    if (warehouses.error) throw warehouses.error
    if (representatives.error) throw representatives.error
    return NextResponse.json({
      vendors: vendors.data ?? [],
      warehouses: warehouses.data ?? [],
      representatives: representatives.data ?? [],
    })
  } catch (error) {
    console.error('Documentation options failed', error)
    return NextResponse.json({ error: 'Unable to load documentation entry options.' }, { status: 500 })
  }
}
