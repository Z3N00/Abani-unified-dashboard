import { notFound } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { hasAccess } from '@/lib/access-control'
import { requireUser } from '@/lib/auth/current-user'
import { getContainerDocumentationDetail } from '@/lib/containers/data'
import DocumentationDetail from './DocumentationDetail'

export default async function DocumentationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  if (!hasAccess(user, 'containers.documentation')) notFound()

  const { id } = await params
  const detail = await getContainerDocumentationDetail(id)
  if (!detail) notFound()

  return <DashboardShell user={user}>
    <main className="documentation-detail-page">
      <DocumentationDetail
        initialDetail={detail}
        canEdit={hasAccess(user, 'containers.documentation', 'write')}
        canUpload={hasAccess(user, 'containers.documentation_upload', 'write')}
        canDelete={user.role === 'ADMIN'}
      />
    </main>
  </DashboardShell>
}
