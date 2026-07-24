import DashboardShell from '@/components/DashboardShell'
import { getAdminWarehouses } from '@/lib/admin/data'
import { requireAdmin } from '@/lib/auth/current-user'

const show = (value: unknown) => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export default async function WarehousesPage() {
  const admin = await requireAdmin()
  const data = await getAdminWarehouses()
  return <DashboardShell user={admin}><main className="admin-operations-page"><AdminHeader eyebrow="ADMINISTRATION" title="Warehouses" copy="SellerCloud warehouse mappings and operational routing." /><div className="admin-data-table"><table><thead><tr><th>Name</th><th>SellerCloud ID</th><th>Slack channel</th><th>Timezone</th><th>Region states</th></tr></thead><tbody>{data.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.address ? show(row.address) : 'No address configured'}</small></td><td>{show(row.sellercloudId)}</td><td>{show(row.slackChannelName)}</td><td>{show(row.timezone)}</td><td>{show(row.regionStates)}</td></tr>)}</tbody></table></div></main></DashboardShell>
}

function AdminHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="admin-operations-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div></header>
}
