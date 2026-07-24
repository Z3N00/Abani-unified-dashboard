'use client'
/* eslint-disable @next/next/no-img-element -- authenticated image redirects cannot be optimized by next/image. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Script from 'next/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authenticatedFetch } from '@/lib/auth/client-fetch'

type Container = { id: string; number: string; sellercloudIds: string[]; status: string; warehouse: string; docsStatus: string; etaPort: string | null; shippedOn: string | null; quantity: number; receivedQuantity: number; port: string; vessel: string; carrier: string }
type ScEntry = { id: string; vendor: string; itemCount: number; quantity: number; receivedQuantity: number; items: Record<string, unknown>[] }
type TimelineRecord = { id?: string; milestone?: string; location?: string; date?: string; isActual?: boolean; vessel?: string }
type Tracking = { origin: string; destination: string; latitude: number | null; longitude: number | null; status: string; eta: string | null; vessel: string; carrier: string; transitDays: number | null }
type PriorityRow = { sku: string; productName: string; status: 'Out of Stock' | 'Low Stock'; onHand: number; inTransit: number; incoming: number }
type DocumentationVendor = { id: string; name: string; status: string; documentCount: number; photoCount: number; reviewedAt: string | null; customsClearedAt: string | null }
type DocumentationRow = { id: string; containerId: string | null; containerNumber: string; warehouse: string; loadingDate: string | null; shippingLine: string; destinationPort: string; freightForwarder: string; isSubmitted: boolean; submittedAt: string | null; arrivalNoticeAt: string | null; scUploadCompletedAt: string | null; updatedAt: string | null; status: string; documentCount: number; photoCount: number; vendors: DocumentationVendor[] }
type PaymentRow = { id: string; entryId: string; containerNumber: string; vendor: string; warehouse: string; totalCost: number; paymentTerms: string; paymentDueDate: string | null; isPaid: boolean; paidAt: string | null; paymentScreenshotName: string; updatedAt: string | null }
type FreightRow = { id: string; entryId: string; containerNumber: string; freightCost: number; freightForwarder: string; updatedAt: string | null }
type PaymentFilter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'due-0-15' | 'due-16-30' | 'due-31-45' | 'due-45-plus'
type Detail = Container & { raw: Record<string, unknown>; items: Record<string, unknown>[]; scEntries: ScEntry[]; milestones: TimelineRecord[]; tracking: Tracking; trucking: Record<string, unknown> | null; documentation: Record<string, unknown>[]; documentVendors: Record<string, unknown>[]; documents: Record<string, unknown>[]; departurePhotos: Record<string, unknown>[]; priorityRestock: PriorityRow[]; inventorySyncedAt: string | null }
type Capabilities = { tracking: boolean; items: boolean; trucking: boolean; timeline: boolean; documentation: boolean; documentationWrite: boolean; payments: boolean; slack: boolean; pdf: boolean; sync: boolean }
type InitialData = { containers: Container[]; archived: Container[]; documentation: DocumentationRow[]; payments: { costs: PaymentRow[]; freight: FreightRow[] } }

const statusClass = (status: string) => status.toLowerCase().replaceAll(' ', '-')
const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value)
const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '-'
const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
const display = (value: unknown) => value === null || value === undefined || value === '' ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const humanize = (value: string) => value
  .replaceAll('_', ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, (character) => character.toUpperCase())
  .replace(/\bSellercloud\b/g, 'SellerCloud')
const eventName = (value: string | undefined) => (value ?? 'Milestone').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())
const paymentTermsLabel = (value: string) => value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) : '-'

function daysUntilPayment(value: string | null) {
  if (!value) return null
  const calendarDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const due = calendarDate
    ? Date.UTC(Number(calendarDate[1]), Number(calendarDate[2]) - 1, Number(calendarDate[3]))
    : new Date(value).getTime()
  if (!Number.isFinite(due)) return null
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due - today) / 86_400_000)
}

function paymentMatchesFilter(row: PaymentRow, filter: PaymentFilter) {
  const days = daysUntilPayment(row.paymentDueDate)
  if (filter === 'all') return true
  if (filter === 'paid') return row.isPaid
  if (filter === 'unpaid') return !row.isPaid
  if (filter === 'overdue') return !row.isPaid && days !== null && days < 0
  if (row.isPaid || days === null || days < 0) return false
  if (filter === 'due-0-15') return days <= 15
  if (filter === 'due-16-30') return days >= 16 && days <= 30
  if (filter === 'due-31-45') return days >= 31 && days <= 45
  return days >= 46
}

function documentationAction(status: string) {
  const actions: Record<string, string> = {
    DOCS_PENDING: 'Overseas',
    DOCS_UPLOADED: 'Admin',
    REVIEWED: 'Overseas',
    IN_SELLERCLOUD: 'Admin',
    CUSTOMS_CLEARED: 'Finance',
    PAID: 'Complete',
  }
  return actions[status] ?? 'Admin'
}

function daysSince(value: string | null) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : null
}

function downloadCsv(filename: string, headings: string[], rows: unknown[][]) {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const content = [headings.map(quote).join(','), ...rows.map((row) => row.map(quote).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function ContainersWorkspace({ capabilities, shipsGoEmbedToken, initialData, initialView = 'active' }: { capabilities: Capabilities; shipsGoEmbedToken: string; initialData: InitialData; initialView?: 'active' | 'archived' | 'documentation' | 'payments' }) {
  const [containers, setContainers] = useState<Container[]>(initialData.containers)
  const [archived, setArchived] = useState<Container[]>(initialData.archived)
  const [documentation, setDocumentation] = useState<DocumentationRow[]>(initialData.documentation)
  const [payments, setPayments] = useState(initialData.payments)
  const [documentationLoaded, setDocumentationLoaded] = useState(initialData.documentation.length > 0)
  const [paymentsLoaded, setPaymentsLoaded] = useState(initialData.payments.costs.length > 0 || initialData.payments.freight.length > 0)
  const [tabLoading, setTabLoading] = useState(false)
  const documentationRequest = useRef<Promise<void> | null>(null)
  const paymentsRequest = useRef<Promise<void> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [warehouse, setWarehouse] = useState('ALL')
  const [docsStatus, setDocsStatus] = useState('ALL')
  const [view, setView] = useState<'active' | 'archived' | 'documentation' | 'payments'>(initialView)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailDataCache = useRef(new Map<string, { expiresAt: number; value: Detail }>())
  const detailRequests = useRef(new Map<string, Promise<Detail>>())
  const detailPrefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [today] = useState(() => Date.now())

  useEffect(() => {
    if (refreshKey === 0) return
    let active = true
    async function loadContainers() {
      try {
        const response = await authenticatedFetch(`/api/containers${refreshKey > 0 ? '?refresh=1' : ''}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load containers.')
        if (!active) return
        setContainers(data.containers ?? [])
        setArchived(data.archived ?? [])
        setError('')
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load containers.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadContainers()
    return () => { active = false }
  }, [refreshKey])

  const loadDocumentation = useCallback(async (fresh = false) => {
    if (documentationRequest.current) return documentationRequest.current
    setTabLoading(true)
    const request = (async () => {
      try {
        const response = await authenticatedFetch(`/api/containers/documentation${fresh ? '?refresh=1' : ''}`)
        const contentType = response.headers.get('content-type') ?? ''
        const data = contentType.includes('application/json')
          ? await response.json()
          : { error: response.status === 404 ? 'The Documentation API is not loaded. Restart the Next.js development server and try again.' : `Documentation returned an unexpected response (${response.status}).` }
        if (!response.ok) throw new Error(data.error || 'Unable to load container documentation.')
        setDocumentation(data.documentation ?? [])
        setDocumentationLoaded(true)
        setError('')
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load container documentation.')
      } finally {
        documentationRequest.current = null
        setTabLoading(false)
      }
    })()
    documentationRequest.current = request
    return request
  }, [])

  const loadPayments = useCallback(async (fresh = false) => {
    if (paymentsRequest.current) return paymentsRequest.current
    setTabLoading(true)
    const request = (async () => {
      try {
        const response = await authenticatedFetch(`/api/containers/payments${fresh ? '?refresh=1' : ''}`)
        const contentType = response.headers.get('content-type') ?? ''
        const data = contentType.includes('application/json')
          ? await response.json()
          : { error: response.status === 404 ? 'The Payments API is not loaded. Restart the Next.js development server and try again.' : `Payments returned an unexpected response (${response.status}).` }
        if (!response.ok) throw new Error(data.error || 'Unable to load container payments.')
        setPayments(data.payments ?? { costs: [], freight: [] })
        setPaymentsLoaded(true)
        setError('')
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load container payments.')
      } finally {
        paymentsRequest.current = null
        setTabLoading(false)
      }
    })()
    paymentsRequest.current = request
    return request
  }, [])

  useEffect(() => {
    if (view === 'documentation' && capabilities.documentation && !documentationLoaded) void loadDocumentation()
    if (view === 'payments' && capabilities.payments && !paymentsLoaded) void loadPayments()
  }, [capabilities.documentation, capabilities.payments, documentationLoaded, loadDocumentation, loadPayments, paymentsLoaded, view])

  const source = useMemo(() => view === 'active' ? containers : view === 'archived' ? archived : [], [archived, containers, view])
  const warehouses = useMemo(() => [...new Set(source.map((container) => container.warehouse).filter((value) => value && value !== '-'))].sort(), [source])
  const statuses = useMemo(() => [...new Set(source.map((container) => container.status))].sort(), [source])
  const visible = useMemo(() => source.filter((container) => {
    const searchText = [container.number, container.status, container.warehouse, container.port, container.carrier, ...container.sellercloudIds].join(' ').toLowerCase()
    return (status === 'ALL' || container.status === status) && (warehouse === 'ALL' || container.warehouse === warehouse) && (docsStatus === 'ALL' || container.docsStatus === docsStatus) && searchText.includes(search.toLowerCase())
  }), [source, search, status, warehouse, docsStatus])
  const arriving = containers.filter((container) => { if (!container.etaPort) return false; const days = Math.ceil((new Date(container.etaPort).getTime() - today) / 86_400_000); return days >= 0 && days <= 7 }).length
  const receiving = containers.filter((container) => container.receivedQuantity > 0 && container.receivedQuantity < container.quantity).length

  const requestDetail = useCallback((id: string) => {
    const cached = detailDataCache.current.get(id)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
    const existing = detailRequests.current.get(id)
    if (existing) return existing

    const request = (async () => {
      const response = await authenticatedFetch(`/api/containers/${encodeURIComponent(id)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load container details.')
      detailDataCache.current.set(id, { value: data as Detail, expiresAt: Date.now() + 5 * 60_000 })
      return data as Detail
    })().finally(() => {
      detailRequests.current.delete(id)
    })
    detailRequests.current.set(id, request)
    return request
  }, [])

  function prefetchDetail(id: string) {
    void requestDetail(id).catch(() => undefined)
  }

  function scheduleDetailPrefetch(id: string) {
    if (detailPrefetchTimer.current) clearTimeout(detailPrefetchTimer.current)
    detailPrefetchTimer.current = setTimeout(() => prefetchDetail(id), 120)
  }

  function cancelDetailPrefetch() {
    if (detailPrefetchTimer.current) clearTimeout(detailPrefetchTimer.current)
    detailPrefetchTimer.current = null
  }

  async function openDetail(id: string) {
    setDetailLoading(true)
    setSelected(null)
    setError('')
    try {
      setSelected(await requestDetail(id))
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load container details.')
    } finally {
      setDetailLoading(false)
    }
  }

  function downloadCurrentView() {
    const date = new Date().toISOString().slice(0, 10)
    if (view === 'active' || view === 'archived') {
      downloadCsv(`containers-${view}-${date}.csv`, ['Container #', 'Sellercloud IDs', 'Warehouse', 'Status', 'Document Status', 'ETA Port', 'Shipped', 'Quantity', 'Received'], visible.map((container) => [
        container.number, container.sellercloudIds.join(', '), container.warehouse, container.status, humanize(container.docsStatus),
        container.etaPort ?? '', container.shippedOn ?? '', container.quantity, container.receivedQuantity,
      ]))
      return
    }
    if (view === 'documentation') {
      downloadCsv(`container-documentation-${date}.csv`, ['Container #', 'Vendors', 'Loading Date', 'Warehouse', 'Sellercloud Link', 'Status', 'Action', 'Days'], documentation.map((row) => [
        row.containerNumber,
        row.vendors.map((vendor) => `${vendor.name} (${humanize(vendor.status)})`).join('; '),
        row.loadingDate ?? '', row.warehouse, row.containerId ? 'Linked' : 'Not linked', humanize(row.status),
        documentationAction(row.status), daysSince(row.updatedAt) ?? '',
      ]))
      return
    }
    downloadCsv(`container-payments-${date}.csv`, ['Container #', 'Vendor', 'Total Cost', 'Terms', 'Due Date', 'Status', 'Days Until Due'], payments.costs.map((row) => {
      const days = daysUntilPayment(row.paymentDueDate)
      return [
        row.containerNumber, row.vendor, row.totalCost.toFixed(2), paymentTermsLabel(row.paymentTerms), row.paymentDueDate ?? '',
        row.isPaid ? 'Paid' : days !== null && days < 0 ? 'Overdue' : 'Unpaid', row.isPaid || days === null ? '' : days,
      ]
    }))
  }

  return <>
    <header className="containers-header"><div><p className="eyebrow">SHIPPING OPERATIONS</p><h1>Containers</h1><p>Live shipping, receiving, and shipment documentation from your existing operations database.</p></div><div className="container-actions"><button className="secondary-action container-download-action" type="button" onClick={downloadCurrentView} disabled={view === 'documentation' ? !documentation.length : view === 'payments' ? !payments.costs.length : !visible.length} aria-label={`Download ${view} data as CSV`} title={`Download ${view} data`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v2h14v-2" /></svg></button><button className="secondary-action" disabled={loading || tabLoading} onClick={() => { if (view === 'documentation') void loadDocumentation(true); else if (view === 'payments') void loadPayments(true); else { setLoading(true); setRefreshKey((value) => value + 1) } }}>{loading || tabLoading ? 'Refreshing…' : 'Refresh'}</button></div></header>
    <nav className="container-list-tabs" aria-label="Container workspace"><button className={view === 'active' ? 'active' : ''} onClick={() => { setView('active'); setStatus('ALL'); setWarehouse('ALL'); setDocsStatus('ALL') }}>Active</button><button className={view === 'archived' ? 'active' : ''} onClick={() => { setView('archived'); setStatus('ALL'); setWarehouse('ALL'); setDocsStatus('ALL') }}>Archived</button>{capabilities.documentation && <button className={view === 'documentation' ? 'active' : ''} onClick={() => setView('documentation')}>Documentation</button>}{capabilities.payments && <button className={view === 'payments' ? 'active' : ''} onClick={() => setView('payments')}>Payments</button>}</nav>
    {view === 'active' && <section className="container-kpis"><Kpi label="Arriving this week" value={arriving} accent="blue" /><Kpi label="In transit" value={containers.length} accent="amber" /><Kpi label="Receiving" value={receiving} accent="green" /></section>}
    {(view === 'active' || view === 'archived') && <section className="container-filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search containers, Sellercloud IDs, ports, carriers..." /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{value}</option>)}</select><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}><option value="ALL">All warehouses</option>{warehouses.map((value) => <option value={value} key={value}>{value}</option>)}</select><select value={docsStatus} onChange={(event) => setDocsStatus(event.target.value)}><option value="ALL">All document statuses</option><option value="DOCS_PENDING">Docs pending</option><option value="DOCS_UPLOADED">Docs uploaded</option><option value="REVIEWED">Reviewed</option><option value="IN_SELLERCLOUD">In Sellercloud</option><option value="CUSTOMS_CLEARED">Customs cleared</option></select></section>}
    {error && <div className="container-error">{error}</div>}
    {(view === 'active' || view === 'archived') && <section className="containers-table-wrap">{loading ? <div className="containers-empty">Loading containers...</div> : visible.length === 0 ? <div className="containers-empty">No containers match the selected filters.</div> : <table className="containers-table"><thead><tr><th>Container</th><th>SC IDs</th><th>Warehouse</th><th>Status</th><th>Docs</th><th>ETA port</th><th>Days away</th><th>Shipped</th><th>Quantity</th><th>Receiving</th></tr></thead><tbody>{visible.map((container) => <tr key={container.id} onPointerEnter={() => scheduleDetailPrefetch(container.id)} onPointerLeave={cancelDetailPrefetch} onFocus={() => prefetchDetail(container.id)} onClick={() => openDetail(container.id)}><td><button className="container-number">{container.number}</button><small>{container.carrier || container.vessel || 'Shipment details'}</small></td><td><ScIdList ids={container.sellercloudIds} /></td><td>{container.warehouse}</td><td><span className={`container-status ${statusClass(container.status)}`}>{container.status}</span></td><td><DocsStatus value={container.docsStatus} /></td><td>{formatDate(container.etaPort)}</td><td><DaysAway eta={container.etaPort} status={container.status} today={today} /></td><td>{formatDate(container.shippedOn)}</td><td>{formatNumber(container.quantity)}</td><td><Receiving quantity={container.quantity} received={container.receivedQuantity} /></td></tr>)}</tbody></table>}</section>}
    {view === 'documentation' && (tabLoading && !documentationLoaded ? <div className="containers-empty tab-loading-panel">Loading documentation…</div> : <DocumentationWorkspace rows={documentation} containers={[...containers, ...archived]} canCreate={capabilities.documentationWrite} onRefresh={() => loadDocumentation(true)} />)}
    {view === 'payments' && (tabLoading && !paymentsLoaded ? <div className="containers-empty tab-loading-panel">Loading payments…</div> : <PaymentsWorkspace data={payments} />)}
    {detailLoading && <div className="detail-overlay"><div className="detail-card loading-detail">Loading shipment details...</div></div>}
    {selected && <DetailModal detail={selected} capabilities={capabilities} shipsGoEmbedToken={shipsGoEmbedToken} close={() => setSelected(null)} />}
  </>
}

function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) { return <article className={`container-kpi ${accent}`}><span>{label}</span><strong>{formatNumber(value)}</strong></article> }
function ScIdList({ ids }: { ids: string[] }) { return ids.length ? <div className="sc-id-list">{ids.map((id) => <span key={id}>{id}</span>)}</div> : '-' }
function Receiving({ quantity, received }: { quantity: number; received: number }) { const percent = quantity > 0 ? Math.min(100, Math.round((received / quantity) * 100)) : 0; return <div className="receiving-cell"><span>{percent}%</span><i><b style={{ width: `${percent}%` }} /></i></div> }
function DaysAway({ eta, status, today }: { eta: string | null; status: string; today: number }) { if (!eta) return <>-</>; const days = Math.ceil((new Date(eta).getTime() - today) / 86_400_000); if (days < 0) return <span className="days-away arrived">{status === 'DELIVERED' ? 'Delivered' : 'Arrived'}</span>; return <span className={`days-away${days <= 3 ? ' urgent' : ''}`}>{days}d</span> }
function DocsStatus({ value }: { value: string }) { const labels: Record<string, string> = { DOCS_PENDING: 'Docs pending', DOCS_UPLOADED: 'Docs uploaded', REVIEWED: 'Reviewed', IN_SELLERCLOUD: 'In Sellercloud', CUSTOMS_CLEARED: 'Customs cleared', PAID: 'Paid' }; const label = labels[value] ?? humanize(value); return <span className={`docs-status ${value.toLowerCase()}`} title={label}><i aria-hidden="true">{value === 'DOCS_PENDING' ? '!' : '✓'}</i>{label}</span> }

function DocumentationWorkspace({ rows, containers, canCreate, onRefresh }: { rows: DocumentationRow[]; containers: Container[]; canCreate: boolean; onRefresh: () => Promise<void> }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const statuses = useMemo(() => [...new Set(rows.map((row) => row.status))].sort(), [rows])
  const visibleRows = useMemo(() => rows.filter((row) => {
    const searchable = [row.containerNumber, row.warehouse, row.shippingLine, row.destinationPort, row.freightForwarder, ...row.vendors.map((vendor) => vendor.name)].join(' ').toLowerCase()
    return (statusFilter === 'ALL' || row.status === statusFilter) && searchable.includes(query.toLowerCase())
  }), [query, rows, statusFilter])
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedIds.has(row.id))

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleRows.forEach((row) => next.delete(row.id))
      else visibleRows.forEach((row) => next.add(row.id))
      return next
    })
  }

  return <section className="top-tab-workspace">
    <header className="top-tab-heading">
      <div><p className="eyebrow">DOCUMENTATION</p><h2>Container documentation</h2><p>Submission, arrival notice, Sellercloud upload, documents, and departure photos.</p></div>
      <div className="documentation-toolbar">
        {canCreate && <button className="documentation-new-entry" type="button" onClick={() => setCreating(true)}>＋ New Entry</button>}
        <strong>{formatNumber(rows.length)} entries</strong>
      </div>
    </header>
    <div className="top-tab-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search containers, vendors, warehouses..." /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All document statuses</option>{statuses.map((value) => <option value={value} key={value}>{humanize(value)}</option>)}</select></div>
    <div className="operations-table-wrap">{visibleRows.length === 0 ? <div className="containers-empty">No documentation entries match the selected filters.</div> : <table className="operations-table documentation-table"><thead><tr><th className="documentation-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible documentation entries" /></th><th>Container #</th><th>Vendors</th><th>Loading Date</th><th>Warehouse</th><th>SC Link</th><th>Status</th><th>Action</th><th>Days</th></tr></thead><tbody>{visibleRows.map((row) => {
      const href = `/containers/documentation/${encodeURIComponent(row.id)}`
      const age = daysSince(row.updatedAt)
      return <tr className="documentation-entry-row" key={row.id} tabIndex={0} onClick={() => router.push(href)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') router.push(href) }}>
        <td className="documentation-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select ${row.containerNumber}`} /></td>
        <td><Link className="documentation-entry-link" href={href}>{row.containerNumber}</Link><small>{row.shippingLine}</small></td>
        <td><div className="documentation-vendor-list">{row.vendors.length ? row.vendors.map((vendor) => <span key={vendor.id}><b>{vendor.name}</b><em>{humanize(vendor.status)}</em></span>) : '—'}</div></td>
        <td>{formatDate(row.loadingDate)}</td><td>{row.warehouse}</td>
        <td><span className={`documentation-sc-link ${row.containerId ? 'linked' : ''}`}>{row.containerId ? 'Linked' : 'Not linked'}</span></td>
        <td><DocsStatus value={row.status} /></td>
        <td><span className={`documentation-action ${documentationAction(row.status).toLowerCase()}`}>{documentationAction(row.status)}</span></td>
        <td><strong className={`documentation-days${age !== null && age >= 7 ? ' aging' : ''}`}>{age === null ? '-' : `${age}d`}</strong></td>
      </tr>
    })}</tbody></table>}</div>
    {creating && <NewDocumentationEntry containers={containers} existingRows={rows} close={() => setCreating(false)} onCreated={async (entryId) => { setCreating(false); await onRefresh(); router.push(`/containers/documentation/${encodeURIComponent(entryId)}`) }} />}
  </section>
}

function NewDocumentationEntry({ containers, existingRows, close, onCreated }: { containers: Container[]; existingRows: DocumentationRow[]; close: () => void; onCreated: (entryId: string) => Promise<void> }) {
  const existingNumbers = useMemo(() => new Set(existingRows.map((row) => row.containerNumber.toLowerCase())), [existingRows])
  const options = useMemo(() => {
    const byNumber = new Map<string, Container>()
    for (const container of containers) {
      if (!existingNumbers.has(container.number.toLowerCase()) && !byNumber.has(container.number)) byNumber.set(container.number, container)
    }
    return [...byNumber.values()].sort((left, right) => left.number.localeCompare(right.number))
  }, [containers, existingNumbers])
  const [containerId, setContainerId] = useState(options[0]?.id ?? '')
  const [freightForwarder, setFreightForwarder] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const selectedContainer = options.find((container) => container.id === containerId)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!containerId) { setMessage('Choose a container first.'); return }
    setSubmitting(true)
    setMessage('')
    try {
      const response = await authenticatedFetch('/api/containers/documentation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerId, freightForwarder }),
      })
      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json') ? await response.json() : { error: `Documentation creation returned an unexpected response (${response.status}).` }
      if (!response.ok) throw new Error(data.error || 'Unable to create the documentation entry.')
      await onCreated(String(data.entryId))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the documentation entry.')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="documentation-create-overlay" role="dialog" aria-modal="true" aria-labelledby="new-documentation-title" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <form className="documentation-create-card" onSubmit={submit}>
      <header><div><p className="eyebrow">DOCUMENTATION</p><h2 id="new-documentation-title">Create a new entry</h2><p>Container, warehouse, vendor, shipping line, and loading details will be linked from the existing shipment.</p></div><button type="button" onClick={close} aria-label="Close">×</button></header>
      <label>Container<select value={containerId} onChange={(event) => setContainerId(event.target.value)} disabled={!options.length}>{options.length ? options.map((container) => <option key={container.id} value={container.id}>{container.number} · {container.warehouse}</option>) : <option value="">No containers available</option>}</select></label>
      {selectedContainer && <div className="documentation-create-preview"><span><small>Warehouse</small><strong>{selectedContainer.warehouse}</strong></span><span><small>Loading date</small><strong>{formatDate(selectedContainer.shippedOn)}</strong></span><span><small>Shipping line</small><strong>{selectedContainer.carrier || '-'}</strong></span><span><small>Destination</small><strong>{selectedContainer.port || '-'}</strong></span></div>}
      <label>Freight forwarder <small>Optional</small><input value={freightForwarder} onChange={(event) => setFreightForwarder(event.target.value)} placeholder="Enter freight forwarder" /></label>
      {message && <p className="documentation-create-error">{message}</p>}
      <footer><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={submitting || !options.length}>{submitting ? 'Creating…' : 'Create entry'}</button></footer>
    </form>
  </div>
}

function PaymentsWorkspace({ data }: { data: { costs: PaymentRow[]; freight: FreightRow[] } }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaymentFilter>('all')
  const vendorTotal = data.costs.reduce((total, row) => total + row.totalCost, 0)
  const paidTotal = data.costs.filter((row) => row.isPaid).reduce((total, row) => total + row.totalCost, 0)
  const outstandingTotal = data.costs.filter((row) => !row.isPaid).reduce((total, row) => total + row.totalCost, 0)
  const freightTotal = data.freight.reduce((total, row) => total + row.freightCost, 0)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleCosts = data.costs
    .filter((row) => [row.containerNumber, row.vendor, row.warehouse, row.paymentTerms].join(' ').toLowerCase().includes(normalizedQuery))
    .filter((row) => paymentMatchesFilter(row, filter))
    .sort((left, right) => {
      if (left.isPaid !== right.isPaid) return left.isPaid ? 1 : -1
      const leftDue = left.paymentDueDate ? new Date(left.paymentDueDate).getTime() : Number.POSITIVE_INFINITY
      const rightDue = right.paymentDueDate ? new Date(right.paymentDueDate).getTime() : Number.POSITIVE_INFINITY
      return leftDue - rightDue
    })
  const visibleFreight = data.freight.filter((row) => [row.containerNumber, row.freightForwarder].join(' ').toLowerCase().includes(query.toLowerCase()))
  const filters: { key: PaymentFilter; label: string; group?: 'due' }[] = [
    { key: 'all', label: 'All' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'paid', label: 'Paid' },
    { key: 'due-0-15', label: 'Due 0–15d', group: 'due' },
    { key: 'due-16-30', label: 'Due 16–30d', group: 'due' },
    { key: 'due-31-45', label: 'Due 31–45d', group: 'due' },
    { key: 'due-45-plus', label: 'Due 45d+', group: 'due' },
  ]

  return <section className="top-tab-workspace">
    <header className="top-tab-heading"><div><p className="eyebrow">PAYMENTS</p><h2>Container payments</h2><p>Vendor costs and freight records from the existing container payment workflow.</p></div><strong>{formatNumber(data.costs.length)} vendor costs</strong></header>
    <section className="payment-kpis"><article><span>Vendor costs</span><strong>{formatCurrency(vendorTotal)}</strong></article><article><span>Paid</span><strong>{formatCurrency(paidTotal)}</strong></article><article><span>Outstanding</span><strong>{formatCurrency(outstandingTotal)}</strong></article><article><span>Freight</span><strong>{formatCurrency(freightTotal)}</strong></article></section>
    <nav className="payment-filter-bar" aria-label="Filter vendor payments">
      {filters.map((item, index) => <span className={item.group === 'due' && filters[index - 1]?.group !== 'due' ? 'payment-filter-start' : ''} key={item.key}>
        <button type="button" className={filter === item.key ? 'active' : ''} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>
      </span>)}
    </nav>
    <div className="top-tab-filters one-field"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search containers, vendors, warehouses, forwarders..." /></div>
    <h3 className="operations-subheading">Vendor costs</h3>
    <div className="operations-table-wrap">{visibleCosts.length === 0 ? <div className="containers-empty">No vendor costs match the selected payment filter.</div> : <table className="operations-table payment-table"><thead><tr><th>Container #</th><th>Vendor</th><th>Total Cost</th><th>Terms</th><th>Due Date</th><th>Status</th><th>Days Until Due</th></tr></thead><tbody>{visibleCosts.map((row) => {
      const days = daysUntilPayment(row.paymentDueDate)
      const overdue = !row.isPaid && days !== null && days < 0
      const status = row.isPaid ? 'Paid' : overdue ? 'Overdue' : 'Unpaid'
      return <tr key={row.id}><td><strong>{row.containerNumber}</strong></td><td>{row.vendor}</td><td>{formatCurrency(row.totalCost)}</td><td>{paymentTermsLabel(row.paymentTerms)}</td><td>{formatDate(row.paymentDueDate)}</td><td><span className={`payment-status ${status.toLowerCase()}`}>{status}</span></td><td><strong className={`payment-days ${row.isPaid ? 'paid' : overdue ? 'overdue' : days !== null && days <= 15 ? 'soon' : ''}`}>{row.isPaid ? '-' : days === null ? '-' : `${days}d`}</strong></td></tr>
    })}</tbody></table>}</div>
    <h3 className="operations-subheading">Freight costs</h3>
    <div className="operations-table-wrap">{visibleFreight.length === 0 ? <div className="containers-empty">No freight costs match this search.</div> : <table className="operations-table freight-table"><thead><tr><th>Container</th><th>Freight forwarder</th><th>Freight cost</th><th>Last updated</th></tr></thead><tbody>{visibleFreight.map((row) => <tr key={row.id}><td><strong>{row.containerNumber}</strong></td><td>{row.freightForwarder}</td><td>{formatCurrency(row.freightCost)}</td><td>{formatDate(row.updatedAt)}</td></tr>)}</tbody></table>}</div>
  </section>
}

function DetailModal({ detail, capabilities, shipsGoEmbedToken, close }: { detail: Detail; capabilities: Capabilities; shipsGoEmbedToken: string; close: () => void }) {
  const tabs = [{ key: 'overview', label: 'Overview', visible: true }, { key: 'items', label: `Items (${detail.items.length})`, visible: capabilities.items }, { key: 'trucking', label: 'Trucking', visible: capabilities.trucking }, { key: 'timeline', label: 'Timeline & map', visible: capabilities.timeline }, { key: 'documentation', label: 'Documentation', visible: capabilities.documentation }]
  const [tab, setTab] = useState('overview')
  return <div className="detail-overlay" role="dialog" aria-modal="true"><section className="detail-card"><header className="detail-header"><div><p className="eyebrow">CONTAINER DETAIL</p><h2>{detail.number} <span className="sc-summary">SC: {detail.sellercloudIds.join(', ') || '-'}</span></h2><span className={`container-status ${statusClass(detail.status)}`}>{detail.status}</span></div><div className="detail-actions">{capabilities.slack && <button disabled>Send to Slack</button>}{capabilities.pdf && <button disabled>Export PDF</button>}<button className="modal-close" onClick={close} aria-label="Close container detail">x</button></div></header><nav className="detail-tabs">{tabs.filter((item) => item.visible).map((item) => <button className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)} key={item.key}>{item.label}</button>)}</nav><div className="detail-content">{tab === 'overview' && <Overview detail={detail} canSync={capabilities.sync} />}{tab === 'items' && <ScItems entries={detail.scEntries} />}{tab === 'trucking' && <Rows rows={detail.trucking ? [detail.trucking] : []} empty="No trucking details have been added for this container." />}{tab === 'timeline' && <TimelineAndMap detail={detail} shipsGoEmbedToken={shipsGoEmbedToken} />}{tab === 'documentation' && <Documentation detail={detail} canUpload={capabilities.documentationWrite} />}</div></section></div>
}

function Overview({ detail, canSync }: { detail: Detail; canSync: boolean }) {
  const raw = (keys: string[]) => { for (const key of keys) { const value = detail.raw[key]; if (value !== undefined && value !== null && value !== '') return String(value) } return '-' }
  const rawDate = (keys: string[]) => { const value = raw(keys); return value === '-' ? '-' : formatDate(value) }
  const money = (keys: string[]) => { const value = raw(keys); const amount = Number(value); return value === '-' || !Number.isFinite(amount) ? '-' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount) }
  const percent = detail.quantity > 0 ? Math.min(100, Math.round((detail.receivedQuantity / detail.quantity) * 100)) : 0
  return <div className="detail-overview">
    <section><h3>Shipping information</h3><Field label="Shipped" value={formatDate(detail.shippedOn)} /><Field label="Sellercloud ETA" value={rawDate(['estimatedArrivalDate', 'etaPort'])} /><Field label="ShipsGo ETA" value={rawDate(['shipsgoEta'])} /><Field label="Port of discharge" value={detail.port || '-'} /><Field label="Warehouse" value={detail.warehouse} /><Field label="Invoice reference" value={raw(['invoiceNumber'])} /></section>
    <section><h3>Vessel tracking</h3><Field label="Tracking status" value={raw(['shipsgoStatus', 'status'])} /><Field label="Shipping line" value={detail.carrier || '-'} /><Field label="Vessel" value={detail.vessel || '-'} /><Field label="Port of loading" value={raw(['portOfLoading'])} /><Field label="Port of discharge" value={raw(['portOfDischarge', 'portName'])} /><Field label="Transit time" value={raw(['transitTime']) === '-' ? '-' : `${raw(['transitTime'])} days`} /><Field label="Schedule delay" value={raw(['delayDays']) === '-' ? '-' : `${raw(['delayDays'])} days`} /><Field label="CO₂ emissions" value={raw(['co2Emissions']) === '-' ? '-' : `${raw(['co2Emissions'])} kg`} /><Field label="Last ShipsGo sync" value={rawDate(['lastShipsgoSync'])} /></section>
    <section><h3>Receiving & warehouse</h3><Field label="Container status" value={detail.status} /><Field label="Container quantity" value={formatNumber(detail.quantity)} /><Field label="Received quantity" value={formatNumber(detail.receivedQuantity)} /><div className="overview-progress"><span>{percent}% received</span><i><b style={{ width: `${percent}%` }} /></i></div><Field label="Received date" value={rawDate(['receivedDate'])} /><Field label="Delivered to warehouse" value={rawDate(['deliveredToWarehouseAt'])} /><Field label="Putaway deadline" value={rawDate(['putawayDeadline'])} /><Field label="Putaway completed" value={rawDate(['putawayCompletedAt'])} /></section>
    <section><h3>Commercial & customs</h3><Field label="Shipping cost" value={money(['shippingCost'])} /><Field label="Ocean freight" value={money(['oceanFreight'])} /><Field label="Import freight" value={money(['importFreightTotal'])} /><Field label="Import taxes" value={money(['importTaxesTotal'])} /><Field label="Tariff" value={money(['importTariffTotal'])} /><Field label="Duty" value={money(['importDutyTotal'])} /><Field label="Customs clearance" value={money(['customsClearance'])} /><Field label="Drayage" value={money(['drayage'])} /></section>
    <SizeBreakdown items={detail.items} />
    <PriorityRestock rows={detail.priorityRestock} syncedAt={detail.inventorySyncedAt} warehouse={detail.warehouse} containerId={detail.id} canSync={canSync} />
  </div>
}
function Field({ label, value }: { label: string; value: string }) { return <div className="detail-field"><span>{label}</span><strong>{value}</strong></div> }

function SizeBreakdown({ items }: { items: Record<string, unknown>[] }) {
  const sizes = new Map<string, { quantity: number; received: number }>()
  for (const item of items) {
    const sku = display(item.sku)
    const itemSize = display(item.size)
    const suffix = sku.match(/-(\d+)$/)?.[1]
    const label = itemSize !== '-' ? itemSize : suffix ? `-${suffix}` : 'Unspecified'
    const current = sizes.get(label) ?? { quantity: 0, received: 0 }
    current.quantity += Number(item.quantity) || 0
    current.received += Number(item.receivedQty) || 0
    sizes.set(label, current)
  }
  const rows = [...sizes.entries()].sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  const largest = Math.max(...rows.map(([, values]) => values.quantity), 1)
  const total = rows.reduce((sum, [, values]) => sum + values.quantity, 0)
  return <section className="overview-wide size-breakdown"><h3>Size breakdown</h3>{rows.length ? <><div className="size-bars">{rows.map(([size, values]) => <div className="size-bar" key={size}><strong>{size}</strong><div><i style={{ width: `${Math.max((values.quantity / largest) * 100, 2)}%` }}><span>{formatNumber(values.quantity)} qty</span></i>{values.received > 0 && <b style={{ width: `${Math.max((values.received / largest) * 100, 2)}%` }} />}</div></div>)}</div><footer><strong>Total</strong><span>{formatNumber(total)} qty</span><small><i /> Total qty <b /> Received</small></footer></> : <p className="overview-note">No size data is linked to the Sellercloud item rows.</p>}</section>
}

function PriorityRestock({ rows, syncedAt, warehouse, containerId, canSync }: { rows: PriorityRow[]; syncedAt: string | null; warehouse: string; containerId: string; canSync: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const [currentRows, setCurrentRows] = useState(rows)
  const [currentSyncedAt, setCurrentSyncedAt] = useState(syncedAt)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const visibleRows = showAll ? currentRows : currentRows.slice(0, 10)

  async function syncContainerInventory() {
    setSyncing(true)
    setSyncMessage('')
    setSyncError('')
    try {
      const response = await authenticatedFetch(`/api/sync/inventory/container/${encodeURIComponent(containerId)}`, { method: 'POST' })
      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json')
        ? await response.json()
        : { error: response.status === 404 ? 'The inventory sync endpoint is not loaded. Restart the Next.js development server and try again.' : `Inventory sync returned an unexpected response (${response.status}).` }
      if (!response.ok) throw new Error(data.error || 'Unable to sync this container inventory.')
      setCurrentRows(data.priorityRestock ?? [])
      setCurrentSyncedAt(data.inventorySyncedAt ?? null)
      setShowAll(false)
      setSyncMessage(`${formatNumber(Number(data.productsSynced) || 0)} SKUs checked · ${formatNumber((data.priorityRestock ?? []).length)} need priority restocking.`)
    } catch (requestError) {
      setSyncError(requestError instanceof Error ? requestError.message : 'Unable to sync this container inventory.')
    } finally {
      setSyncing(false)
    }
  }

  return <section className="overview-wide priority-restock">
    <header className="priority-restock-head">
      <div><h3>Priority Restock <span>{currentRows.length}</span></h3>
      <p>{currentSyncedAt ? `at ${warehouse} · inventory synced ${formatDate(currentSyncedAt)}` : 'Inventory has not been synced yet'}</p></div>
      {canSync && <button className="priority-restock-sync" type="button" onClick={syncContainerInventory} disabled={syncing}>{syncing ? 'Checking Sellercloud…' : 'Sync priority stock'}</button>}
    </header>
    {syncMessage && <p className="priority-restock-message success">{syncMessage}</p>}
    {syncError && <p className="priority-restock-message error">{syncError}</p>}
    <div className="priority-restock-table" role="region" aria-label="Priority restock inventory">
      <table>
        <thead><tr><th>Status</th><th>SKU</th><th>Product</th><th>On Hand</th><th>In Transit</th><th>Incoming</th></tr></thead>
        <tbody>{currentRows.length ? visibleRows.map((row) => <tr key={row.sku} className={`priority-restock-row ${row.status === 'Low Stock' ? 'low-stock' : 'out-of-stock'}`}><td><span>{row.status}</span></td><td>{row.sku}</td><td>{row.productName}</td><td className={row.onHand <= 0 ? 'stock-zero' : 'stock-low'}>{formatNumber(row.onHand)}</td><td>{formatNumber(row.inTransit)}</td><td className="stock-incoming">{formatNumber(row.incoming)}</td></tr>) : <tr className="priority-restock-empty"><td colSpan={6}>{currentSyncedAt ? 'No low-stock incoming SKUs for this container.' : 'The initial Sellercloud inventory sync has not run yet.'}</td></tr>}</tbody>
      </table>
    </div>
    {currentRows.length > 10 && <button className="priority-restock-toggle" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show less' : `Show all ${currentRows.length} items`}</button>}
  </section>
}

function TimelineAndMap({ detail, shipsGoEmbedToken }: { detail: Detail; shipsGoEmbedToken: string }) {
  const completed = detail.milestones.filter((event) => event.isActual).length
  const progress = detail.milestones.length ? Math.round((completed / detail.milestones.length) * 100) : 0
  const mapUrl = shipsGoEmbedToken ? `https://embed.shipsgo.com/?token=${encodeURIComponent(shipsGoEmbedToken)}` : ''
  return <div className="timeline-map"><section className="voyage-card"><header><div><p className="eyebrow">VOYAGE TIMELINE</p><h3>{detail.tracking.origin} <span>to</span> {detail.tracking.destination}</h3></div><span className={`container-status ${statusClass(detail.tracking.status)}`}>{detail.tracking.status}</span></header>{detail.milestones.length ? <div className="voyage-events">{detail.milestones.map((event, index) => <article className={event.isActual ? 'actual' : 'planned'} key={event.id ?? `${event.milestone}-${index}`}><i /><div><strong>{eventName(event.milestone)}</strong><span>{event.location || '-'}</span>{event.vessel && <small>Vessel: {event.vessel}</small>}</div><time>{formatDate(event.date)}<small>{event.isActual ? 'Actual' : 'Estimated'}</small></time></article>)}</div> : <div className="detail-empty">No shipment milestones are recorded yet.</div>}<footer><span>Transit progress</span><i><b style={{ width: `${progress}%` }} /></i><strong>{detail.status}</strong></footer></section><section className="live-map-card"><header><div><p className="eyebrow">LIVE TRACKING</p><h3>Live tracking map</h3></div><span>{detail.tracking.vessel || detail.tracking.carrier || 'ShipsGo'}</span></header>{mapUrl ? <><iframe id="shipsgo-embed" src={mapUrl} title="Live ShipsGo tracking map" /><Script src="https://embed.shipsgo.com/embed-integration.js" strategy="afterInteractive" /></> : <MapSetup detail={detail} />}</section></div>
}

function MapSetup({ detail }: { detail: Detail }) { return <div className="map-setup"><div className="map-grid"><i /><i /><i /></div><div className="route-line"><b>{detail.tracking.origin.slice(0, 2).toUpperCase()}</b><span /><b>{detail.tracking.destination.slice(0, 2).toUpperCase()}</b></div><div className="map-copy"><strong>Live map ready to connect</strong><p>Add <code>SHIPSGO_EMBED_TOKEN</code> to <code>.env</code> to show ShipsGo&apos;s live vessel map.</p><small>Stored route: {detail.tracking.origin} to {detail.tracking.destination}</small></div></div> }

function ScItems({ entries }: { entries: ScEntry[] }) { const [open, setOpen] = useState<string | null>(null); if (!entries.length) return <div className="detail-empty">No Sellercloud item rows are linked to this container.</div>; return <div className="sc-entries">{entries.map((entry) => <article key={entry.id} className="sc-entry"><button className="sc-entry-head" onClick={() => setOpen(open === entry.id ? null : entry.id)}><span className="sc-chevron">{open === entry.id ? 'v' : '>'}</span><strong>SC #{entry.id}</strong><span className="sc-vendor">{entry.vendor}</span><span className="sc-entry-total">{entry.itemCount} items</span><span className="sc-entry-total">{formatNumber(entry.quantity)} qty</span></button>{open === entry.id && <ItemTable items={entry.items} />}</article>)}</div> }
function ItemTable({ items }: { items: Record<string, unknown>[] }) { return <div className="sc-item-table"><table><thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Qty</th><th>Received</th></tr></thead><tbody>{items.map((item, index) => <tr key={String(item.id ?? index)}><td>{display(item.sku)}</td><td>{display(item.productName)}</td><td>{display(item.size)}</td><td>{display(item.quantity)}</td><td>{display(item.receivedQty)}</td></tr>)}</tbody></table></div> }

function Documentation({ detail, canUpload }: { detail: Detail; canUpload: boolean }) {
  const documentsByVendor = new Map<string, Record<string, unknown>[]>()
  const photosByVendor = new Map<string, Record<string, unknown>[]>()
  for (const document of detail.documents) { const id = display(document.containerDocVendorId); documentsByVendor.set(id, [...(documentsByVendor.get(id) ?? []), document]) }
  for (const photo of detail.departurePhotos) { const id = display(photo.containerDocVendorId); photosByVendor.set(id, [...(photosByVendor.get(id) ?? []), photo]) }
  if (!detail.documentVendors.length) return <div className="detail-empty">No documentation package has been created for this container yet.</div>
  return <div className="documentation-library"><header><div><p className="eyebrow">DOCUMENT LIBRARY</p><h3>Shipment documents & photos</h3></div><span className={`docs-access${canUpload ? '' : ' view'}`}>{canUpload ? 'Upload enabled' : 'View only'}</span></header>{detail.documentVendors.map((vendor) => { const id = display(vendor.id); const documents = documentsByVendor.get(id) ?? []; const photos = photosByVendor.get(id) ?? []; return <article className="vendor-docs" key={id}><div className="vendor-docs-head"><div><h4>Vendor documentation</h4><p>Status: {display(vendor.status)}</p></div><span>{documents.length} documents · {photos.length} photos</span></div><div className="document-grid">{documents.map((document) => <DocumentCard key={display(document.id)} document={document} containerId={detail.id} />)}</div>{photos.length > 0 && <><h5>Departure photos</h5><div className="photo-grid">{photos.map((photo) => <PhotoCard key={display(photo.id)} photo={photo} containerId={detail.id} />)}</div></>}{canUpload && <DocumentUploader containerId={detail.id} vendorId={id} />}</article>})}</div>
}
function DocumentCard({ document, containerId }: { document: Record<string, unknown>; containerId: string }) { return <a className="document-card" href={`/api/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(display(document.id))}?kind=document`} target="_blank" rel="noreferrer"><span>PDF</span><div><strong>{display(document.fileName)}</strong><small>{humanize(display(document.type))}</small></div></a> }
function PhotoCard({ photo, containerId }: { photo: Record<string, unknown>; containerId: string }) {
  const fileUrl = `/api/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(display(photo.id))}?kind=photo`
  const label = display(photo.caption) === '-' ? display(photo.fileName) : display(photo.caption)
  return <a className="photo-card" href={fileUrl} target="_blank" rel="noreferrer" aria-label={`Open photo: ${label}`}><img src={fileUrl} alt={label} /></a>
}

function DocumentUploader({ containerId, vendorId }: { containerId: string; vendorId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<'document' | 'departure-photo'>('document')
  const [documentType, setDocumentType] = useState('OTHER')
  const [caption, setCaption] = useState('')
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  async function upload() {
    if (!file) { setMessage('Choose a PDF or image first.'); return }
    setUploading(true); setMessage('')
    const body = new FormData(); body.set('file', file); body.set('vendorId', vendorId); body.set('kind', kind); body.set('documentType', documentType); body.set('caption', caption)
    try {
      const response = await authenticatedFetch(`/api/containers/${encodeURIComponent(containerId)}/documents`, { method: 'POST', body })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Upload failed.')
      setMessage('Uploaded. Refreshing the document library…')
      window.setTimeout(() => window.location.reload(), 450)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.') } finally { setUploading(false) }
  }
  return <div className="document-uploader"><div><strong>Add to this vendor package</strong><p>PDF, JPEG, PNG, or WebP · 15 MB maximum</p></div><div className="upload-controls"><select value={kind} onChange={(event) => setKind(event.target.value as 'document' | 'departure-photo')}><option value="document">Document</option><option value="departure-photo">Departure photo</option></select>{kind === 'document' ? <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="BILL_OF_LADING">Bill of lading</option><option value="COMMERCIAL_INVOICE">Commercial invoice</option><option value="PACKING_SLIP">Packing slip</option><option value="ISF_FORM">ISF form</option><option value="ARRIVAL_NOTICE">Arrival notice</option><option value="OTHER">Other</option></select> : <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Optional caption" />}</div><div className="upload-controls"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><button type="button" onClick={upload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload file'}</button></div>{message && <p className="upload-message">{message}</p>}</div>
}
function Rows({ rows, empty }: { rows: Record<string, unknown>[]; empty: string }) { if (!rows.length) return <div className="detail-empty">{empty}</div>; const columns = Object.keys(rows[0]).filter((key) => !['id', 'containerId'].includes(key)).slice(0, 6); return <div className="detail-rows"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{display(row[column])}</td>)}</tr>)}</tbody></table></div> }
