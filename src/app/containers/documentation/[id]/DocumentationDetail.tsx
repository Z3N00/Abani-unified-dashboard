'use client'
/* eslint-disable @next/next/no-img-element -- authenticated file routes require regular image elements. */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { ContainerDocumentationDetail } from '@/lib/containers/data'
import { authenticatedFetch } from '@/lib/auth/client-fetch'

const STATUS_STEPS = ['DOCS_PENDING', 'DOCS_UPLOADED', 'REVIEWED', 'IN_SELLERCLOUD', 'CUSTOMS_CLEARED', 'PAID'] as const
const STATUS_LABELS: Record<string, string> = {
  DOCS_PENDING: 'Docs Pending',
  DOCS_UPLOADED: 'Docs Uploaded',
  REVIEWED: 'Reviewed',
  IN_SELLERCLOUD: 'In SellerCloud',
  CUSTOMS_CLEARED: 'Customs Cleared',
  PAID: 'Paid',
}

const formatDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
  : '—'
const formatDateTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  : '—'
const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
const formatSize = (value: number) => value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`
const humanize = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())

export default function DocumentationDetail({ initialDetail, canEdit, canUpload, canDelete = false, external = false, token = initialDetail.uploadToken }: { initialDetail: ContainerDocumentationDetail; canEdit: boolean; canUpload: boolean; canDelete?: boolean; external?: boolean; token?: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState(initialDetail)
  const [editing, setEditing] = useState(false)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const currentStep = Math.max(0, STATUS_STEPS.indexOf(detail.status as (typeof STATUS_STEPS)[number]))
  const totalDocuments = detail.vendors.reduce((total, vendor) => total + vendor.documents.length, 0)
  const totalPhotos = detail.vendors.reduce((total, vendor) => total + vendor.photos.length, 0)
  const nextAction = useMemo(() => {
    const incomplete = detail.vendors.filter((vendor) => vendor.status === detail.status).map((vendor) => vendor.name).join(', ')
    if (detail.status === 'DOCS_PENDING') return `Overseas representative needs to upload the required documents${incomplete ? ` for ${incomplete}` : ''}.`
    if (detail.status === 'DOCS_UPLOADED') return `Admin needs to review documents and confirm ISF${incomplete ? ` for ${incomplete}` : ''}.`
    if (detail.status === 'REVIEWED') return `Admin needs to upload the reviewed documents to SellerCloud${incomplete ? ` for ${incomplete}` : ''}.`
    if (detail.status === 'IN_SELLERCLOUD') return `Customs clearance is pending${incomplete ? ` for ${incomplete}` : ''}.`
    if (detail.status === 'CUSTOMS_CLEARED') return `Payment confirmation is pending${incomplete ? ` for ${incomplete}` : ''}.`
    return 'Documentation workflow is complete.'
  }, [detail])

  async function resendEmail() {
    if (!window.confirm(`Queue a documentation reminder email for ${detail.containerNumber}?`)) return
    setSending(true)
    setMessage('')
    setError('')
    try {
      const response = await authenticatedFetch(`/api/documentation/${encodeURIComponent(detail.id)}/resend-email`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to queue the email.')
      setMessage(data.message || 'Documentation email queued.')
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to queue the email.')
    } finally {
      setSending(false)
    }
  }

  async function deleteEntry() {
    if (!window.confirm('Delete this pending documentation request? This cannot be undone.')) return
    setDeleting(true)
    setMessage('')
    setError('')
    try {
      const response = await authenticatedFetch(`/api/containers/documentation?id=${encodeURIComponent(detail.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to delete the documentation request.')
      router.push('/containers?tab=documentation')
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete the documentation request.')
      setDeleting(false)
    }
  }

  return <>
    {!external && <Link className="documentation-back" href="/containers?tab=documentation">← Back to containers</Link>}
    <section className="documentation-summary-card">
      <div className="documentation-title-line"><div><h1>{detail.containerId ? detail.containerNumber : 'Container # Pending'}</h1><span className={`workflow-status ${detail.status.toLowerCase()}`}>{STATUS_LABELS[detail.status] ?? humanize(detail.status)}</span></div><div className="documentation-actions">{!external && canEdit && <button type="button" onClick={resendEmail} disabled={sending || deleting}>✉ {sending ? 'Queueing…' : 'Resend Email'}</button>}{!external && canDelete && !detail.containerId && <button className="delete-documentation" type="button" onClick={deleteEntry} disabled={deleting || sending}>{deleting ? 'Deleting…' : 'Delete'}</button>}{!external && canEdit && <button type="button" onClick={() => setEditing(true)} disabled={deleting}>✎ Edit</button>}</div></div>
      {!external && detail.containerId && <Link className="linked-container" href="/containers?tab=active">⚓ {detail.containerNumber}</Link>}
      <div className="documentation-facts"><Fact label="Loading Date" value={formatDate(detail.loadingDate)} /><Fact label="Shipping Line" value={detail.shippingLine} /><Fact label="Destination" value={detail.destinationPort} /><Fact label="Warehouse" value={detail.warehouse} /></div>
      <p><span>Overseas Rep:</span> {detail.overseasRep}</p>
      <p><span>Freight Forwarder:</span> {detail.freightForwarder}</p>
      {message && <div className="documentation-feedback success">{message}</div>}
      {error && <div className="documentation-feedback error">{error}</div>}
    </section>

    <section className="documentation-progress-card">
      <header><h2>Documentation Progress</h2><div><span className={detail.arrivalNotice ? 'complete' : ''}>{detail.arrivalNotice ? '✓' : '○'} Arrival Notice</span><span className={detail.freight ? 'complete' : ''}>{detail.freight ? '✓' : '○'} Freight</span></div></header>
      <div className="workflow-steps">{STATUS_STEPS.map((status, index) => <div className={`workflow-step ${index < currentStep ? 'complete' : index === currentStep ? 'current' : ''}`} key={status}><div><i>{index < currentStep ? '✓' : '○'}</i>{index < STATUS_STEPS.length - 1 && <b />}</div><span>{STATUS_LABELS[status]}</span></div>)}</div>
      <div className="vendor-progress">{detail.vendors.map((vendor) => <span key={vendor.id}><i /> <strong>{vendor.name}</strong> {STATUS_LABELS[vendor.status] ?? humanize(vendor.status)}</span>)}</div>
    </section>

    <div className="documentation-next">Next: {nextAction}</div>

    {canUpload && token && !detail.isSubmitted && <DocumentationSubmission detail={detail} token={token} updated={setDetail} />}

    <section className="documentation-content-card">
      <header><div><p className="eyebrow">DOCUMENT LIBRARY</p><h2>Shipment documents & photos</h2></div><div><strong>{totalDocuments}</strong> documents · <strong>{totalPhotos}</strong> photos{canUpload && <span className={detail.containerId ? 'upload-enabled' : 'upload-locked'}>{detail.containerId ? 'Upload enabled' : 'Upload locked'}</span>}</div></header>
      {canUpload && !detail.containerId && <div className="documentation-upload-locked"><strong>Link the container before uploading.</strong><span>Enter the SellerCloud container number above. Once it is linked, document and departure-photo upload controls will appear for each vendor.</span></div>}
      {detail.vendors.map((vendor) => <VendorPackage detail={detail} vendor={vendor} canUpload={canUpload && !detail.isSubmitted && Boolean(detail.containerId)} token={token} updated={setDetail} key={vendor.id} />)}
    </section>

    {detail.warehousePhotos.length > 0 && <section className="documentation-content-card"><header><div><p className="eyebrow">WAREHOUSE RECEIVING</p><h2>Warehouse photos</h2></div><strong>{detail.warehousePhotos.length} photos</strong></header><div className="documentation-photo-grid">{detail.warehousePhotos.map((photo) => { const url = `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(photo.id)}?kind=warehouse-photo&token=${encodeURIComponent(token)}`; return <a href={url} target="_blank" rel="noreferrer" key={photo.id}><img src={url} alt={photo.fileName} /><span>{humanize(photo.type)}</span></a> })}</div></section>}

    <section className="documentation-lower-grid">
      <article className="documentation-content-card compact"><h2>Freight & payment</h2><DetailLine label="Freight forwarder" value={detail.freight?.freightForwarder || detail.freightForwarder} /><DetailLine label="Freight cost" value={detail.freight ? formatCurrency(detail.freight.freightCost) : 'Not added'} />{detail.vendors.map((vendor) => <div className="vendor-payment" key={vendor.id}><strong>{vendor.name}</strong><DetailLine label="Vendor cost" value={vendor.cost ? formatCurrency(vendor.cost.totalCost) : 'Not added'} /><DetailLine label="Payment terms" value={vendor.cost ? humanize(vendor.cost.paymentTerms) : '—'} /><DetailLine label="Due date" value={vendor.cost ? formatDate(vendor.cost.paymentDueDate) : '—'} /><DetailLine label="Payment status" value={vendor.cost?.isPaid ? `Paid ${formatDate(vendor.cost.paidAt)}` : 'Unpaid'} /></div>)}</article>
      <article className="documentation-content-card compact"><h2>Activity</h2><div className="documentation-activity">{detail.activity.slice(0, 30).map((activity) => <div key={activity.id}><i /><p><strong>{humanize(activity.action)}</strong><span>{activity.actor}</span><small>{formatDateTime(activity.createdAt)}</small></p></div>)}</div></article>
    </section>

    {editing && <EditDocumentation detail={detail} close={() => setEditing(false)} saved={(updated) => { setDetail(updated); setEditing(false); setMessage('Container documentation updated.') }} />}
  </>
}

function DocumentationSubmission({ detail, token, updated }: { detail: ContainerDocumentationDetail; token: string; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [containerNumber, setContainerNumber] = useState('')
  const [freightCost, setFreightCost] = useState(detail.freight ? String(detail.freight.freightCost) : '')
  const [freightForwarder, setFreightForwarder] = useState(detail.freight?.freightForwarder || (detail.freightForwarder === '—' ? '' : detail.freightForwarder))
  const [working, setWorking] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function update(action: 'set-container' | 'save-freight' | 'submit') {
    setWorking(action)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'set-container' ? { action, containerNumber } : action === 'save-freight' ? { action, freightCost, freightForwarder } : { action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update this documentation request.')
      updated(data.detail)
      setMessage(action === 'set-container' ? 'Container linked. Document uploads are now enabled.' : action === 'save-freight' ? 'Freight information saved.' : 'Documentation submitted for admin review.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update this documentation request.')
    } finally {
      setWorking('')
    }
  }

  return <section className="documentation-content-card documentation-submission">
    <header><div><p className="eyebrow">OVERSEAS WORKSPACE</p><h2>Complete documentation request</h2></div></header>
    {!detail.containerId && <div className="documentation-link-container"><label><span>Container number</span><input value={containerNumber} onChange={(event) => setContainerNumber(event.target.value.toUpperCase())} placeholder="Enter the SellerCloud container number" /></label><button type="button" disabled={!containerNumber || working !== ''} onClick={() => void update('set-container')}>{working === 'set-container' ? 'Linking…' : 'Link container'}</button></div>}
    {detail.containerId && <div className="documentation-freight-form"><label><span>Freight forwarder</span><input value={freightForwarder} onChange={(event) => setFreightForwarder(event.target.value)} /></label><label><span>Freight cost</span><input type="number" min="0" step="0.01" value={freightCost} onChange={(event) => setFreightCost(event.target.value)} placeholder="0.00" /></label><button type="button" disabled={!freightCost || working !== ''} onClick={() => void update('save-freight')}>{working === 'save-freight' ? 'Saving…' : 'Save freight'}</button><button className="submit-documentation" type="button" disabled={working !== ''} onClick={() => void update('submit')}>{working === 'submit' ? 'Submitting…' : 'Submit for admin review'}</button></div>}
    {message && <p className="documentation-feedback success">{message}</p>}
    {error && <p className="documentation-feedback error">{error}</p>}
  </section>
}

function TokenFileUpload({ token, vendorId, updated }: { token: string; vendorId: string; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [kind, setKind] = useState<'document' | 'departure-photo'>('document')
  const [documentType, setDocumentType] = useState('COMMERCIAL_INVOICE')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function upload() {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('vendorId', vendorId)
      formData.set('kind', kind)
      if (kind === 'document') formData.set('documentType', documentType)
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to upload this file.')
      updated(data.detail)
      setFile(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload this file.')
    } finally {
      setUploading(false)
    }
  }

  return <div className="token-file-upload">
    <select value={kind} onChange={(event) => setKind(event.target.value as 'document' | 'departure-photo')}><option value="document">Document</option><option value="departure-photo">Departure photo</option></select>
    {kind === 'document' && <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="COMMERCIAL_INVOICE">Commercial Invoice</option><option value="BILL_OF_LADING">Bill of Lading</option><option value="PACKING_SLIP">Packing Slip</option><option value="ISF_FORM">ISF Form</option><option value="OTHER">Other</option></select>}
    <label><input type="file" accept={kind === 'document' ? '.pdf,.xlsx,.xls,.jpg,.jpeg,.png,.webp' : 'image/jpeg,image/png,image/webp'} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file?.name || 'Choose file'}</span></label>
    <button type="button" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? 'Uploading…' : 'Upload'}</button>
    {error && <small>{error}</small>}
  </div>
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function DetailLine({ label, value }: { label: string; value: string }) { return <div className="documentation-detail-line"><span>{label}</span><strong>{value}</strong></div> }

function VendorPackage({ detail, vendor, canUpload, token, updated }: { detail: ContainerDocumentationDetail; vendor: ContainerDocumentationDetail['vendors'][number]; canUpload: boolean; token: string; updated: (detail: ContainerDocumentationDetail) => void }) {
  return <article className="documentation-vendor-package">
    <header><div><h3>{vendor.name}</h3><p>{STATUS_LABELS[vendor.status] ?? humanize(vendor.status)} · ISF {vendor.isfConfirmed ? 'confirmed' : 'not confirmed'}</p></div><span>{vendor.documents.length} documents · {vendor.photos.length} photos</span></header>
    {canUpload && <TokenFileUpload token={token} vendorId={vendor.id} updated={updated} />}
    <div className="documentation-document-grid">{vendor.documents.map((document) => { const url = `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(document.id)}?kind=document&token=${encodeURIComponent(token)}`; return <a href={url} target="_blank" rel="noreferrer" key={document.id}><i>{document.fileName.toLowerCase().endsWith('.pdf') ? 'PDF' : 'FILE'}</i><span><strong>{document.fileName}</strong><small>{humanize(document.type)} · {formatSize(document.fileSize)}</small></span></a> })}</div>
    {vendor.photos.length > 0 && <><h4>Departure photos</h4><div className="documentation-photo-grid">{vendor.photos.map((photo) => { const url = `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(photo.id)}?kind=photo&token=${encodeURIComponent(token)}`; return <a href={url} target="_blank" rel="noreferrer" key={photo.id}><img src={url} alt={photo.caption || photo.fileName} loading="lazy" /><span>{photo.caption || photo.fileName}</span></a> })}</div></>}
    {vendor.reviewNotes && <div className="review-notes"><strong>Review notes</strong><p>{vendor.reviewNotes}</p></div>}
  </article>
}

function EditDocumentation({ detail, close, saved }: { detail: ContainerDocumentationDetail; close: () => void; saved: (detail: ContainerDocumentationDetail) => void }) {
  const [form, setForm] = useState({ loadingDate: detail.loadingDate?.slice(0, 10) ?? '', shippingLine: detail.shippingLine === '—' ? '' : detail.shippingLine, destinationPort: detail.destinationPort === '—' ? '' : detail.destinationPort, freightForwarder: detail.freightForwarder === '—' ? '' : detail.freightForwarder, warehouseId: detail.warehouseId ?? '', overseasRepId: detail.overseasRepId ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/documentation/${encodeURIComponent(detail.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update documentation.')
      saved(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update documentation.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="documentation-edit-overlay" role="dialog" aria-modal="true"><form className="documentation-edit-card" onSubmit={submit}><header><h2>Edit documentation</h2><button type="button" onClick={close} aria-label="Close">×</button></header><label>Loading date<input type="date" value={form.loadingDate} onChange={(event) => setForm({ ...form, loadingDate: event.target.value })} /></label><label>Shipping line<input value={form.shippingLine} onChange={(event) => setForm({ ...form, shippingLine: event.target.value })} /></label><label>Destination<input value={form.destinationPort} onChange={(event) => setForm({ ...form, destinationPort: event.target.value })} /></label><label>Warehouse<select value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}><option value="">Select warehouse</option>{detail.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></label><label>Overseas representative<select value={form.overseasRepId} onChange={(event) => setForm({ ...form, overseasRepId: event.target.value })}><option value="">Select representative</option>{detail.overseasReps.map((representative) => <option value={representative.id} key={representative.id}>{representative.name} · {representative.email}</option>)}</select></label><label>Freight forwarder<input value={form.freightForwarder} onChange={(event) => setForm({ ...form, freightForwarder: event.target.value })} /></label>{error && <p className="documentation-feedback error">{error}</p>}<footer><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></footer></form></div>
}
