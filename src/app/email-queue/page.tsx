import DashboardShell from '@/components/DashboardShell'
import { requireAdmin } from '@/lib/auth/current-user'
import EmailQueueClient from './EmailQueueClient'

export default async function EmailQueuePage() {
  const admin = await requireAdmin()
  return <DashboardShell user={admin}><main className="admin-operations-page"><EmailQueueClient /></main></DashboardShell>
}
