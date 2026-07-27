import DashboardShell from '@/components/DashboardShell'
import { getAdminSettings } from '@/lib/admin/data'
import { requireAdmin } from '@/lib/auth/current-user'
import EmailIntegrationCard from './EmailIntegrationCard'

const sensitive = (key: string) => /password|secret|token|api.?key|credential/i.test(key)

export default async function SettingsPage() {
  const admin = await requireAdmin()
  const data = await getAdminSettings()
  const smtpConfigured = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].every((key) => Boolean(process.env[key]?.trim()))
  const smtpAddress = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'the configured mailbox'

  return <DashboardShell user={admin}>
    <main className="admin-operations-page">
      <header className="admin-operations-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Settings</h1>
          <p>Legacy integration configuration. Secret values are always masked.</p>
        </div>
      </header>
      <EmailIntegrationCard configured={smtpConfigured} address={smtpAddress} />
      <section className="settings-list">
        {data.map((row) => <article key={row.key}>
          <div>
            <strong>{String(row.key).replaceAll('_', ' ')}</strong>
            <small>Updated {row.updatedAt ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(row.updatedAt)) : '—'}</small>
          </div>
          <code>{sensitive(row.key) ? '••••••••••••' : String(row.value ?? 'Not configured')}</code>
        </article>)}
      </section>
    </main>
  </DashboardShell>
}
