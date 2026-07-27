'use client'
/* eslint-disable @next/next/no-img-element -- authenticated file routes require regular image elements. */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
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

    {canUpload && token && !detail.isSubmitted && !detail.containerId && <DocumentationSubmission detail={detail} token={token} updated={setDetail} />}

    <section className="documentation-content-card">
      <header><div><p className="eyebrow">DOCUMENT LIBRARY</p><h2>Shipment documents & photos</h2></div><div><strong>{totalDocuments}</strong> documents · <strong>{totalPhotos}</strong> photos{canUpload && <span className={detail.containerId ? 'upload-enabled' : 'upload-locked'}>{detail.containerId ? 'Upload enabled' : 'Upload locked'}</span>}</div></header>
      {canUpload && !detail.containerId && <div className="documentation-upload-locked"><strong>Link the container before uploading.</strong><span>Enter the SellerCloud container number above. Once it is linked, document and departure-photo upload controls will appear for each vendor.</span></div>}
      {detail.vendors.map((vendor) => <VendorPackage detail={detail} vendor={vendor} canUpload={canUpload && !detail.isSubmitted && Boolean(detail.containerId)} token={token} updated={setDetail} key={vendor.id} />)}
    </section>

    {detail.containerId && <TokenWarehouseArrivalPhotos detail={detail} token={token} canUpload={canUpload && !detail.isSubmitted} updated={setDetail} />}

    {canUpload && token && !detail.isSubmitted && Boolean(detail.containerId) && <DocumentationSubmission detail={detail} token={token} updated={setDetail} />}

    <section className="documentation-lower-grid">
      <article className="documentation-content-card compact"><h2>Freight & payment</h2><DetailLine label="Freight forwarder" value={detail.freight?.freightForwarder || detail.freightForwarder} /><DetailLine label="Freight cost" value={detail.freight ? formatCurrency(detail.freight.freightCost) : 'Not added'} />{detail.vendors.map((vendor) => <div className="vendor-payment" key={vendor.id}><strong>{vendor.name}</strong><DetailLine label="Vendor cost" value={vendor.cost ? formatCurrency(vendor.cost.totalCost) : 'Not added'} /><DetailLine label="Payment terms" value={vendor.cost ? humanize(vendor.cost.paymentTerms) : '—'} /><DetailLine label="Due date" value={vendor.cost ? formatDate(vendor.cost.paymentDueDate) : '—'} /><DetailLine label="Payment status" value={vendor.cost?.isPaid ? `Paid ${formatDate(vendor.cost.paidAt)}` : 'Unpaid'} /></div>)}</article>
      <article className="documentation-content-card compact"><h2>Activity</h2><div className="documentation-activity">{detail.activity.slice(0, 30).map((activity) => <div key={activity.id}><i /><p><strong>{humanize(activity.action)}</strong><span>{activity.actor === 'Overseas documentation link' ? detail.overseasRep : activity.actor}</span><small>{formatDateTime(activity.createdAt)}</small></p></div>)}</div></article>
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
    {detail.containerId && <>
      <div className="documentation-freight-form"><label><span>Freight forwarder</span><input value={freightForwarder} onChange={(event) => setFreightForwarder(event.target.value)} /></label><label><span>Freight cost</span><input type="number" min="0" step="0.01" value={freightCost} onChange={(event) => setFreightCost(event.target.value)} placeholder="0.00" /></label><button type="button" disabled={!freightCost || !freightForwarder.trim() || working !== ''} onClick={() => void update('save-freight')}>{working === 'save-freight' ? 'Saving…' : 'Save freight'}</button></div>
      <div className="documentation-submit-row"><div><strong>Submit Documentation</strong><span>Send the current documentation package to the admin for review. Missing items can be handled during review.</span></div><button className="submit-documentation" type="button" disabled={working !== ''} onClick={() => void update('submit')}>{working === 'submit' ? 'Submitting…' : 'Submit for admin review'}</button></div>
    </>}
    {message && <p className="documentation-feedback success">{message}</p>}
    {error && <p className="documentation-feedback error">{error}</p>}
  </section>
}

function TokenFileUpload({ token, vendorId, updated }: { token: string; vendorId: string; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [kind, setKind] = useState<'document' | 'departure-photo'>('document')
  const [documentType, setDocumentType] = useState('COMMERCIAL_INVOICE')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function upload() {
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      let latestDetail: ContainerDocumentationDetail | null = null
      for (const file of files) {
        const formData = new FormData()
        formData.set('file', file)
        formData.set('vendorId', vendorId)
        formData.set('kind', kind)
        if (kind === 'document') formData.set('documentType', documentType)
        const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads`, { method: 'POST', body: formData })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `Unable to upload ${file.name}.`)
        latestDetail = data.detail
      }
      if (latestDetail) updated(latestDetail)
      setFiles([])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload this file.')
    } finally {
      setUploading(false)
    }
  }

  return <div className="token-file-upload">
    <select value={kind} onChange={(event) => { setKind(event.target.value as 'document' | 'departure-photo'); setFiles([]) }}><option value="document">Document</option><option value="departure-photo">Departure photos</option></select>
    {kind === 'document' && <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="COMMERCIAL_INVOICE">Commercial Invoice</option><option value="BILL_OF_LADING">Bill of Lading</option><option value="PACKING_SLIP">Packing Slip</option><option value="ISF_FORM">ISF Form</option><option value="OTHER">Other</option></select>}
    <label><input type="file" multiple={kind === 'departure-photo'} accept={kind === 'document' ? '.pdf,.xlsx,.xls,.jpg,.jpeg,.png,.webp' : 'image/jpeg,image/png,image/webp'} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><span>{files.length ? kind === 'departure-photo' && files.length > 1 ? `${files.length} photos selected` : files[0].name : kind === 'document' ? 'Choose document' : 'Choose photos'}</span></label>
    <button type="button" disabled={!files.length || uploading} onClick={() => void upload()}>{uploading ? `Uploading ${files.length}…` : files.length > 1 ? `Upload ${files.length} photos` : 'Upload'}</button>
    {error && <small>{error}</small>}
  </div>
}

const WAREHOUSE_PHOTO_SLOTS = [
  { type: 'SEAL', label: 'Seal' },
  { type: 'OPENED', label: 'Opened' },
  { type: 'EMPTY', label: 'Empty' },
  { type: 'SIGNED_BOL', label: 'Signed BOL' },
] as const

function TokenWarehouseArrivalPhotos({ detail, token, canUpload, updated }: { detail: ContainerDocumentationDetail; token: string; canUpload: boolean; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [uploadingType, setUploadingType] = useState('')
  const [removingId, setRemovingId] = useState('')
  const [error, setError] = useState('')
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const vendorId = detail.vendors[0]?.id ?? ''
  const galleryPhotos = WAREHOUSE_PHOTO_SLOTS.flatMap((slot) => {
    const photo = detail.warehousePhotos.find((candidate) => candidate.type === slot.type)
    return photo ? [{ url: `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(photo.id)}?kind=warehouse-photo&token=${encodeURIComponent(token)}`, label: `${slot.label} warehouse arrival` }] : []
  })

  async function upload(photoType: string, file: File) {
    setUploadingType(photoType)
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('vendorId', vendorId)
      formData.set('kind', 'warehouse-photo')
      formData.set('photoType', photoType)
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to upload this warehouse arrival photo.')
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload this warehouse arrival photo.')
    } finally {
      setUploadingType('')
    }
  }

  async function remove(photoId: string) {
    setRemovingId(photoId)
    setError('')
    try {
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads?photoId=${encodeURIComponent(photoId)}&kind=warehouse-photo`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to remove this warehouse arrival photo.')
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to remove this warehouse arrival photo.')
    } finally {
      setRemovingId('')
    }
  }

  return <section className="documentation-content-card warehouse-arrival-card">
    <header><div><p className="eyebrow">WAREHOUSE RECEIVING</p><h2>Warehouse Arrival Photos</h2><small>Receiving evidence shared across all vendor packages</small></div><strong>({detail.warehousePhotos.length}/4)</strong></header>
    <div className="warehouse-photo-slots">{WAREHOUSE_PHOTO_SLOTS.map((slot) => {
      const photo = detail.warehousePhotos.find((candidate) => candidate.type === slot.type)
      const url = photo ? `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(photo.id)}?kind=warehouse-photo&token=${encodeURIComponent(token)}` : ''
      return <article className={`warehouse-photo-slot${photo ? ' uploaded' : ''}`} key={slot.type}>
        <h5>{slot.label}</h5>
        {photo ? <button className="warehouse-photo-preview" type="button" onClick={() => setGalleryIndex(galleryPhotos.findIndex((item) => item.url === url))}><img src={url} alt={`${slot.label} warehouse arrival`} /><span>View photo</span></button> : <div className="empty-photo-slot"><span aria-hidden="true">▣</span><small>Not uploaded</small></div>}
        {canUpload && <div className="warehouse-photo-actions"><label className="replace-photo"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!vendorId || uploadingType !== '' || removingId !== ''} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void upload(slot.type, selected); event.currentTarget.value = '' }} /><span>{uploadingType === slot.type ? 'Uploading…' : photo ? 'Replace' : 'Upload'}</span></label>{photo && <button type="button" disabled={uploadingType !== '' || removingId !== ''} onClick={() => void remove(photo.id)}>{removingId === photo.id ? 'Removing…' : 'Remove'}</button>}</div>}
      </article>
    })}</div>
    {error && <p className="documentation-feedback error">{error}</p>}
    {galleryIndex !== null && <GalleryLightbox photos={galleryPhotos} index={galleryIndex} close={() => setGalleryIndex(null)} change={setGalleryIndex} />}
  </section>
}

function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function DetailLine({ label, value }: { label: string; value: string }) { return <div className="documentation-detail-line"><span>{label}</span><strong>{value}</strong></div> }

function TokenDeparturePhoto({ detail, photo, photos, photoIndex, vendorId, token, canEdit, updated }: { detail: ContainerDocumentationDetail; photo: ContainerDocumentationDetail['vendors'][number]['photos'][number]; photos: ContainerDocumentationDetail['vendors'][number]['photos']; photoIndex: number; vendorId: string; token: string; canEdit: boolean; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const url = `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(photo.id)}?kind=photo&token=${encodeURIComponent(token)}`
  const galleryPhotos = photos.map((item) => ({
    url: `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(item.id)}?kind=photo&token=${encodeURIComponent(token)}`,
    label: item.caption || item.fileName,
  }))

  async function replace(file: File) {
    setWorking('replace')
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('vendorId', vendorId)
      formData.set('kind', 'departure-photo')
      formData.set('replacePhotoId', photo.id)
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to replace this photo.')
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to replace this photo.')
    } finally {
      setWorking('')
    }
  }

  async function remove() {
    if (!window.confirm('Delete this departure photo?')) return
    setWorking('remove')
    setError('')
    try {
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads?kind=departure-photo&photoId=${encodeURIComponent(photo.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to delete this photo.')
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete this photo.')
    } finally {
      setWorking('')
    }
  }

  return <article className="token-departure-photo">
    <button className="departure-photo-preview" type="button" onClick={() => setGalleryIndex(photoIndex)}><img src={url} alt={photo.caption || photo.fileName} loading="lazy" /><span>{photo.caption || photo.fileName}</span></button>
    {canEdit && <div><label className="replace-photo"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={working !== ''} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void replace(selected); event.currentTarget.value = '' }} /><span>{working === 'replace' ? 'Replacing…' : 'Replace'}</span></label><button type="button" disabled={working !== ''} onClick={() => void remove()}>{working === 'remove' ? 'Deleting…' : 'Delete'}</button></div>}
    {error && <small>{error}</small>}
    {galleryIndex !== null && <GalleryLightbox photos={galleryPhotos} index={galleryIndex} close={() => setGalleryIndex(null)} change={setGalleryIndex} />}
  </article>
}

function VendorPackage({ detail, vendor, canUpload, token, updated }: { detail: ContainerDocumentationDetail; vendor: ContainerDocumentationDetail['vendors'][number]; canUpload: boolean; token: string; updated: (detail: ContainerDocumentationDetail) => void }) {
  const [documentIndex, setDocumentIndex] = useState<number | null>(null)
  const viewerDocuments = vendor.documents.map((document) => ({
    id: document.id,
    url: `/api/documentation/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(document.id)}?kind=document&token=${encodeURIComponent(token)}`,
    fileName: document.fileName,
    type: humanize(document.type),
    documentType: document.type,
    fileSize: document.fileSize,
  }))
  return <article className="documentation-vendor-package">
    <header><div><h3>{vendor.name}</h3><p>{STATUS_LABELS[vendor.status] ?? humanize(vendor.status)} · ISF {vendor.isfConfirmed ? 'confirmed' : 'not confirmed'}</p></div><span>{vendor.documents.length} documents · {vendor.photos.length} photos</span></header>
    {canUpload && <TokenFileUpload token={token} vendorId={vendor.id} updated={updated} />}
    <div className="documentation-document-grid">{vendor.documents.map((document, index) => <button type="button" onClick={() => setDocumentIndex(index)} key={document.id}><i>{document.fileName.toLowerCase().endsWith('.pdf') ? 'PDF' : 'FILE'}</i><span><strong>{document.fileName}</strong><small>{humanize(document.type)} · {formatSize(document.fileSize)}</small></span></button>)}</div>
    {vendor.photos.length > 0 && <><h4>Departure photos</h4><div className="documentation-photo-grid">{vendor.photos.map((photo, photoIndex) => <TokenDeparturePhoto detail={detail} photo={photo} photos={vendor.photos} photoIndex={photoIndex} vendorId={vendor.id} token={token} canEdit={canUpload} updated={updated} key={photo.id} />)}</div></>}
    {vendor.reviewNotes && <div className="review-notes"><strong>Review notes</strong><p>{vendor.reviewNotes}</p></div>}
    {documentIndex !== null && <DocumentLightbox documents={viewerDocuments} index={documentIndex} vendorId={vendor.id} token={token} canEdit={canUpload} updated={updated} close={() => setDocumentIndex(null)} change={setDocumentIndex} />}
  </article>
}

function GalleryLightbox({ photos, index, close, change }: { photos: { url: string; label: string }[]; index: number; close: () => void; change: (index: number) => void }) {
  const previousIndex = (index - 1 + photos.length) % photos.length
  const nextIndex = (index + 1) % photos.length

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft' && photos.length > 1) change(previousIndex)
      if (event.key === 'ArrowRight' && photos.length > 1) change(nextIndex)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [change, close, nextIndex, photos.length, previousIndex])

  const photo = photos[index]
  if (!photo) return null
  return <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="Photo gallery" onClick={close}>
    <button className="photo-lightbox-close" type="button" onClick={close} aria-label="Close gallery">×</button>
    {photos.length > 1 && <button className="photo-lightbox-previous" type="button" onClick={(event) => { event.stopPropagation(); change(previousIndex) }} aria-label="Previous photo">‹</button>}
    <figure onClick={(event) => event.stopPropagation()}><img src={photo.url} alt={photo.label} /><figcaption><span>{photo.label}</span><strong>{index + 1} / {photos.length}</strong></figcaption></figure>
    {photos.length > 1 && <button className="photo-lightbox-next" type="button" onClick={(event) => { event.stopPropagation(); change(nextIndex) }} aria-label="Next photo">›</button>}
  </div>
}

function DocumentLightbox({ documents, index, vendorId, token, canEdit, updated, close, change }: { documents: { id: string; url: string; fileName: string; type: string; documentType: string; fileSize: number }[]; index: number; vendorId: string; token: string; canEdit: boolean; updated: (detail: ContainerDocumentationDetail) => void; close: () => void; change: (index: number) => void }) {
  const previousIndex = (index - 1 + documents.length) % documents.length
  const nextIndex = (index + 1) % documents.length
  const currentDocument = documents[index]
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft' && documents.length > 1) change(previousIndex)
      if (event.key === 'ArrowRight' && documents.length > 1) change(nextIndex)
    }
    window.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [change, close, documents.length, nextIndex, previousIndex])

  if (!currentDocument) return null
  const extension = currentDocument.fileName.split('.').pop()?.toLowerCase() ?? ''
  const isPdf = extension === 'pdf'
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)

  async function replace(file: File) {
    setWorking('replace')
    setError('')
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('vendorId', vendorId)
      formData.set('kind', 'document')
      formData.set('documentType', currentDocument.documentType)
      formData.set('replaceDocumentId', currentDocument.id)
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to replace this document.')
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to replace this document.')
    } finally {
      setWorking('')
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${currentDocument.fileName}?`)) return
    setWorking('remove')
    setError('')
    try {
      const response = await fetch(`/api/documentation/token/${encodeURIComponent(token)}/uploads?kind=document&documentId=${encodeURIComponent(currentDocument.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to delete this document.')
      close()
      updated(data.detail)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete this document.')
    } finally {
      setWorking('')
    }
  }

  return <div className="document-lightbox" role="dialog" aria-modal="true" aria-label="Document viewer" onClick={close}>
    <button className="document-lightbox-close" type="button" onClick={close} aria-label="Close document viewer">×</button>
    {documents.length > 1 && <button className="document-lightbox-previous" type="button" onClick={(event) => { event.stopPropagation(); change(previousIndex) }} aria-label="Previous document">‹</button>}
    <section onClick={(event) => event.stopPropagation()}>
      <header><div><strong>{currentDocument.fileName}</strong><span>{currentDocument.type} · {formatSize(currentDocument.fileSize)}</span>{error && <small className="document-viewer-error">{error}</small>}</div><div><b>{index + 1} / {documents.length}</b>{canEdit && <label className="document-replace"><input type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png,.webp" disabled={working !== ''} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void replace(selected); event.currentTarget.value = '' }} /><span>{working === 'replace' ? 'Replacing…' : 'Replace'}</span></label>}{canEdit && <button className="document-delete" type="button" disabled={working !== ''} onClick={() => void remove()}>{working === 'remove' ? 'Deleting…' : 'Delete'}</button>}<a href={currentDocument.url} download>Download</a></div></header>
      <div className="document-preview-stage">
        {isPdf && <iframe src={currentDocument.url} title={currentDocument.fileName} />}
        {isImage && <img src={currentDocument.url} alt={currentDocument.fileName} />}
        {!isPdf && !isImage && <div className="document-preview-fallback"><i>FILE</i><h3>Preview is not available for this file type</h3><p>{currentDocument.fileName}</p><a href={currentDocument.url} download>Download document</a></div>}
      </div>
    </section>
    {documents.length > 1 && <button className="document-lightbox-next" type="button" onClick={(event) => { event.stopPropagation(); change(nextIndex) }} aria-label="Next document">›</button>}
  </div>
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
