import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { hasAccess } from '@/lib/access-control'
import { requireUser } from '@/lib/auth/current-user'
import { clearContainerDataCache, getContainerDetail } from '@/lib/containers/data'
import { addBusinessDays } from '@/lib/slack/notifications'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function ConfirmContainerArrivalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const containerNumber = decodeURIComponent(id).trim().toUpperCase()
  const canConfirm = hasAccess(user, 'containers.trucking', 'write') || user.role === 'WAREHOUSE_GENERAL'
  const container = await getContainerDetail(containerNumber)
  if (!container) redirect('/containers')

  async function confirmArrival() {
    'use server'
    const currentUser = await requireUser()
    if (!hasAccess(currentUser, 'containers.trucking', 'write') && currentUser.role !== 'WAREHOUSE_GENERAL') redirect('/containers')

    const db = createAdminClient()
    const { data: rows, error: lookupError } = await db
      .from('Container')
      .select('id')
      .eq('containerName', containerNumber)
    if (lookupError) throw lookupError
    if (!rows?.length) redirect('/containers')

    const arrivedAt = new Date()
    const deadline = addBusinessDays(arrivedAt, 5)
    const ids = rows.map((row) => row.id)
    const [containerUpdate, truckingUpdate] = await Promise.all([
      db.from('Container').update({
        status: 'DELIVERED',
        deliveredToWarehouseAt: arrivedAt.toISOString(),
        putawayDeadline: deadline.toISOString(),
        updatedAt: arrivedAt.toISOString(),
      }).in('id', ids),
      db.from('TruckingInfo').update({
        actualDeliveryDate: arrivedAt.toISOString(),
        updatedAt: arrivedAt.toISOString(),
      }).in('containerId', ids),
    ])
    if (containerUpdate.error || truckingUpdate.error) throw containerUpdate.error || truckingUpdate.error
    clearContainerDataCache()
    redirect(`/containers?container=${encodeURIComponent(containerNumber)}`)
  }

  const alreadyConfirmed = Boolean(container.raw.deliveredToWarehouseAt || container.trucking?.actualDeliveryDate)

  return (
    <DashboardShell user={user}>
      <main className="containers-page">
        <section className="access-denied">
          <p className="eyebrow">WAREHOUSE RECEIVING</p>
          <h1>Confirm {container.number} arrived</h1>
          <p>
            Warehouse: <strong>{container.warehouse}</strong><br />
            Quantity: <strong>{container.quantity.toLocaleString('en-US')}</strong>
          </p>
          {alreadyConfirmed ? (
            <p>This container has already been confirmed at the warehouse.</p>
          ) : canConfirm ? (
            <>
              <p>Confirming starts the five-business-day putaway period and enables daily warehouse reminders.</p>
              <form action={confirmArrival}>
                <button className="primary-action" type="submit">Confirm received at warehouse</button>
              </form>
            </>
          ) : (
            <p>You do not have permission to confirm warehouse receiving.</p>
          )}
        </section>
      </main>
    </DashboardShell>
  )
}
