import DashboardShell from '@/components/DashboardShell'
import { hasAccess } from '@/lib/access-control'
import { requireUser } from '@/lib/auth/current-user'
import { getContainers } from '@/lib/containers/data'
import ContainersWorkspace from './ContainersWorkspace'

export default async function ContainersPage({ searchParams }: { searchParams: Promise<{ tab?: string; container?: string; detailTab?: string }> }) {
  const user = await requireUser()
  const { tab, container, detailTab } = await searchParams
  const canView = hasAccess(user, 'containers')
  const canViewDocumentation = hasAccess(user, 'containers.documentation')
  const canViewPayments = hasAccess(user, 'containers.payments')
  const shipsGoEmbedToken = process.env.SHIPSGO_EMBED_TOKEN ?? ''
  const initialData = canView ? { ...(await getContainers()), documentation: [], payments: { costs: [], freight: [] } } : null

  return (
    <DashboardShell user={user}>
      <main className="containers-page">
        {canView && initialData ? <ContainersWorkspace initialData={initialData} initialContainerNumber={container} initialDetailTab={detailTab} initialView={tab === 'documentation' && canViewDocumentation ? 'documentation' : tab === 'payments' && canViewPayments ? 'payments' : tab === 'archived' ? 'archived' : 'active'} shipsGoEmbedToken={shipsGoEmbedToken} capabilities={{ tracking: hasAccess(user, 'containers.tracking'), items: hasAccess(user, 'containers.items'), trucking: hasAccess(user, 'containers.trucking'), timeline: hasAccess(user, 'containers.timeline'), documentation: canViewDocumentation, documentationWrite: hasAccess(user, 'containers.documentation_upload', 'write'), documentationAdmin: user.role === 'ADMIN', payments: canViewPayments, slack: hasAccess(user, 'containers.slack'), pdf: hasAccess(user, 'containers.pdf'), sync: hasAccess(user, 'containers.sync', 'write') }} /> : <section className="access-denied"><p className="eyebrow">RESTRICTED MODULE</p><h1>Containers access is not assigned.</h1><p>Ask an administrator to give you access to the Containers module.</p></section>}
      </main>
    </DashboardShell>
  )
}
