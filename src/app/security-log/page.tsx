import DashboardShell from '@/components/DashboardShell'
import { getAdminSecurityLog } from '@/lib/admin/data'
import { requireAdmin } from '@/lib/auth/current-user'

const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'

export default async function SecurityLogPage() {
  const admin = await requireAdmin()
  const { logs, users } = await getAdminSecurityLog()
  const names = new Map(users.map((user) => [user.id, user.name || user.email]))
  return <DashboardShell user={admin}><main className="admin-operations-page"><header className="admin-operations-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Security Log</h1><p>Authentication, authorization, and administrative events.</p></div></header><div className="admin-data-table"><table><thead><tr><th>Event</th><th>User</th><th>Details</th><th>IP</th><th>Time</th></tr></thead><tbody>{logs.map((row) => <tr key={row.id}><td><span className="security-event">{String(row.event).replaceAll('_', ' ')}</span></td><td>{names.get(row.userId) || 'System / unknown'}</td><td>{typeof row.details === 'string' ? row.details : JSON.stringify(row.details ?? {})}</td><td>{typeof row.ip === 'string' ? row.ip : '—'}</td><td>{date(row.createdAt)}</td></tr>)}</tbody></table></div></main></DashboardShell>
}
