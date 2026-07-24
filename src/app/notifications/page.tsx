import DashboardShell from '@/components/DashboardShell'
import { getAdminNotifications } from '@/lib/admin/data'
import { requireAdmin } from '@/lib/auth/current-user'

const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'

export default async function NotificationsPage() {
  const admin = await requireAdmin()
  const data = await getAdminNotifications()
  return <DashboardShell user={admin}><main className="admin-operations-page"><header className="admin-operations-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Notifications</h1><p>Recent container alerts and delivery results.</p></div></header><div className="admin-data-table"><table><thead><tr><th>Status</th><th>Type</th><th>Message</th><th>Channel</th><th>Sent</th></tr></thead><tbody>{data.map((row) => <tr key={row.id}><td><span className={`delivery-result ${row.success ? 'success' : 'failed'}`}>{row.success ? 'Sent' : 'Failed'}</span></td><td>{String(row.type).replaceAll('_', ' ')}</td><td><strong>{row.message}</strong>{row.errorMessage && <small>{String(row.errorMessage)}</small>}</td><td>{row.channel || '—'}</td><td>{date(row.sentAt)}</td></tr>)}</tbody></table></div></main></DashboardShell>
}
