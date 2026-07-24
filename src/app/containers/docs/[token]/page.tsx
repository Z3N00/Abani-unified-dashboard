import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getContainerDocumentationDetail } from '@/lib/containers/data'
import DocumentationDetail from '../../documentation/[id]/DocumentationDetail'

export default async function OverseasDocumentationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = createAdminClient()
  const { data: entry, error } = await db.from('ContainerDocEntry').select('id').eq('photoToken', token).maybeSingle()
  if (error || !entry) notFound()
  const detail = await getContainerDocumentationDetail(String(entry.id))
  if (!detail) notFound()
  const publicDetail = { ...detail, warehouses: [], overseasReps: [], uploadToken: '' }

  return <main className="external-documentation-page">
    <div className="external-documentation-brand"><span>ABANI</span><small>Secure documentation workspace</small></div>
    <DocumentationDetail initialDetail={publicDetail} canEdit={false} canUpload external token={token} />
  </main>
}
