import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

type Row = Record<string, unknown>
type ContainerListResult = { containers: ContainerSummary[]; archived: ContainerSummary[] }

const CONTAINER_LIST_COLUMNS = 'id,containerName,sellercloudId,status,shipsgoStatus,warehouseId,etaPort,estimatedArrivalDate,shipsgoEta,shippedOn,receivedDate,totalQty,totalReceived,portName,portOfLoading,portOfDischarge,vesselName,vesselNumber,shippingLine,updatedAt'
let listCache: { expiresAt: number; value: ContainerListResult } | null = null
let documentationCache: { expiresAt: number; value: ContainerDocumentationRow[] } | null = null
let paymentsCache: { expiresAt: number; value: ContainerPaymentsResult } | null = null
const detailCache = new Map<string, { expiresAt: number; value: ContainerDetail | null }>()
let snapshotUnavailableUntil = 0

/** Invalidates read caches after a server-side data sync. */
export function clearContainerDataCache() {
  listCache = null
  documentationCache = null
  paymentsCache = null
  detailCache.clear()
  snapshotUnavailableUntil = 0
  revalidateTag('containers-list', 'max')
  revalidateTag('container-details', 'max')
}

export type ContainerSummary = {
  id: string
  number: string
  sellercloudIds: string[]
  status: string
  warehouse: string
  etaPort: string | null
  shippedOn: string | null
  receivedOn: string | null
  quantity: number
  receivedQuantity: number
  port: string
  vessel: string
  carrier: string
  docsStatus: string
}

export type ContainerDetail = ContainerSummary & {
  raw: Row
  items: Row[]
  scEntries: { id: string; vendor: string; itemCount: number; quantity: number; receivedQuantity: number; items: Row[] }[]
  milestones: Row[]
  tracking: { origin: string; destination: string; latitude: number | null; longitude: number | null; status: string; eta: string | null; vessel: string; carrier: string; transitDays: number | null }
  trucking: Row | null
  documentation: Row[]
  documentVendors: Row[]
  documents: Row[]
  departurePhotos: Row[]
  priorityRestock: { sku: string; productName: string; status: 'Out of Stock' | 'Low Stock'; onHand: number; inTransit: number; incoming: number }[]
  inventorySyncedAt: string | null
}

export type ContainerDocumentationVendor = {
  id: string
  name: string
  status: string
  documentCount: number
  photoCount: number
  reviewedAt: string | null
  customsClearedAt: string | null
}

export type ContainerDocumentationRow = {
  id: string
  containerId: string | null
  containerNumber: string | null
  warehouse: string
  loadingDate: string | null
  shippingLine: string
  destinationPort: string
  freightForwarder: string
  isSubmitted: boolean
  submittedAt: string | null
  arrivalNoticeAt: string | null
  scUploadCompletedAt: string | null
  updatedAt: string | null
  invitationStatus: string | null
  status: string
  documentCount: number
  photoCount: number
  vendors: ContainerDocumentationVendor[]
}

export type ContainerPaymentRow = {
  id: string
  entryId: string
  containerNumber: string
  vendor: string
  warehouse: string
  totalCost: number
  paymentTerms: string
  paymentDueDate: string | null
  isPaid: boolean
  paidAt: string | null
  paymentScreenshotName: string
  updatedAt: string | null
}

export type ContainerFreightRow = {
  id: string
  entryId: string
  containerNumber: string
  freightCost: number
  freightForwarder: string
  updatedAt: string | null
}

export type ContainerPaymentsResult = {
  costs: ContainerPaymentRow[]
  freight: ContainerFreightRow[]
}

export type ContainerDocumentationDetail = {
  id: string
  containerId: string | null
  containerNumber: string
  loadingDate: string | null
  shippingLine: string
  destinationPort: string
  freightForwarder: string
  warehouseId: string | null
  warehouse: string
  overseasRepId: string | null
  overseasRep: string
  isSubmitted: boolean
  submittedAt: string | null
  arrivalNotice: boolean
  arrivalNoticeAt: string | null
  scUploadCompletedAt: string | null
  status: string
  vendors: {
    id: string
    vendorId: string
    name: string
    status: string
    reviewedBy: string
    reviewedAt: string | null
    reviewNotes: string
    isfConfirmed: boolean
    customsClearedAt: string | null
    documents: { id: string; type: string; fileName: string; fileSize: number; uploadedAt: string | null }[]
    photos: { id: string; fileName: string; fileSize: number; caption: string; uploadedAt: string | null }[]
    cost: { id: string; totalCost: number; paymentTerms: string; paymentDueDate: string | null; isPaid: boolean; paidAt: string | null; paymentScreenshotName: string } | null
  }[]
  freight: { id: string; freightCost: number; freightForwarder: string; updatedAt: string | null } | null
  warehousePhotos: { id: string; type: string; fileName: string; fileSize: number; uploadedByName: string; uploadedAt: string | null }[]
  activity: { id: string; vendorDocId: string | null; action: string; actor: string; details: Row | null; createdAt: string | null }[]
  latestEmail: { id: string; type: string; status: string; subject: string; queuedAt: string | null; sentAt: string | null } | null
  warehouses: { id: string; name: string }[]
  overseasReps: { id: string; name: string; email: string }[]
}

function first(row: Row, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key]
  return null
}

function text(row: Row, keys: string[], fallback = ''): string {
  const value = first(row, keys)
  return value === null ? fallback : String(value)
}

function numeric(row: Row, keys: string[]): number {
  const value = first(row, keys)
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function dateValue(row: Row, keys: string[]): string | null {
  const value = first(row, keys)
  return value ? String(value) : null
}

function normalize(row: Row): ContainerSummary {
  const sellercloud = first(row, ['sellercloudId', 'sellercloudIds', 'sellercloudContainerId', 'scId'])
  const sellercloudIds = Array.isArray(sellercloud) ? sellercloud.map(String) : sellercloud ? String(sellercloud).split(',').map((value) => value.trim()).filter(Boolean) : []
  return {
    id: text(row, ['id']),
    number: text(row, ['containerName', 'containerNumber', 'number'], 'Untitled container'),
    sellercloudIds,
    status: text(row, ['status', 'shipsgoStatus'], 'PENDING').replaceAll('_', ' '),
    warehouse: text(row, ['warehouseName', 'warehouse', 'warehouseCode'], '—'),
    etaPort: dateValue(row, ['etaPort', 'estimatedArrivalDate', 'shipsgoEta', 'eta']),
    shippedOn: dateValue(row, ['shippedOn', 'shippedDate', 'loadingDate']),
    receivedOn: dateValue(row, ['receivedDate', 'receivedOn']),
    quantity: numeric(row, ['totalQty', 'quantity', 'qty', 'totalQuantity', 'units']),
    receivedQuantity: numeric(row, ['receivedQty', 'receivedQuantity', 'totalReceived']),
    port: text(row, ['portName', 'portOfDischarge', 'destinationPort']),
    vessel: text(row, ['vesselName', 'vessel']),
    carrier: text(row, ['carrierName', 'shippingLine', 'carrier']),
    docsStatus: text(row, ['docsStatus'], 'DOCS_PENDING'),
  }
}

function mergeContainerRows(rows: Row[]): ContainerSummary {
  const summaries = rows.map(normalize)
  const primary = summaries.reduce((current, candidate) => statusRank(candidate) > statusRank(current) ? candidate : current)
  return {
    ...primary,
    id: primary.number,
    sellercloudIds: [...new Set(summaries.flatMap((summary) => summary.sellercloudIds))],
    docsStatus: summaries.reduce((current, candidate) => (DOC_STATUS_RANK[candidate.docsStatus] ?? 0) < (DOC_STATUS_RANK[current] ?? 0) ? candidate.docsStatus : current, primary.docsStatus),
    quantity: summaries.reduce((total, summary) => total + summary.quantity, 0),
    receivedQuantity: summaries.reduce((total, summary) => total + summary.receivedQuantity, 0),
  }
}

const STATUS_RANK: Record<string, number> = {
  PENDING: 0, BOOKED: 1, LOADED: 2, SAILING: 3, ARRIVED: 4, DISCHARGED: 5, NOT_RELEASED: 6,
  GATE_OUT: 7, IN_TRANSIT_TRUCK: 8, DELIVERED: 9, PUTAWAY_COMPLETE: 10, CLOSED: 11,
}

function statusRank(summary: ContainerSummary) {
  return STATUS_RANK[summary.status.toUpperCase().replaceAll(' ', '_')] ?? -1
}

const DOC_STATUS_RANK: Record<string, number> = { DOCS_PENDING: 0, DOCS_UPLOADED: 1, REVIEWED: 2, IN_SELLERCLOUD: 3, CUSTOMS_CLEARED: 4, PAID: 5 }
const SELLERCLOUD_WAREHOUSE_IDS: Record<string, string> = {
  nfiwh1: '161',
  deringerwh2: '167',
  dynwh3: '262',
  jaxwh4: '274',
  txwh5: '330',
  cawh6: '351',
  cawh7: '352',
  njwh8: '353',
  pawh9: '354',
}

function primaryRow(rows: Row[]) {
  return rows.map((row) => ({ row, summary: normalize(row) })).reduce((current, candidate) => statusRank(candidate.summary) > statusRank(current.summary) ? candidate : current).row
}

function sortContainers(containers: ContainerSummary[]) {
  return containers.sort((left, right) => {
    const leftDate = left.etaPort ? new Date(left.etaPort).getTime() : Number.MAX_SAFE_INTEGER
    const rightDate = right.etaPort ? new Date(right.etaPort).getTime() : Number.MAX_SAFE_INTEGER
    return leftDate - rightDate
  })
}

function sortArchivedContainers(containers: ContainerSummary[]) {
  return containers.sort((left, right) => {
    const leftDate = left.receivedOn ?? left.etaPort
    const rightDate = right.receivedOn ?? right.etaPort
    const leftTime = leftDate ? new Date(leftDate).getTime() : 0
    const rightTime = rightDate ? new Date(rightDate).getTime() : 0
    return rightTime - leftTime
  })
}

async function loadContainersFromDatabase(): Promise<ContainerListResult> {
  const db = createAdminClient()
  let rows: Row[] | null = null

  if (snapshotUnavailableUntil <= Date.now()) {
    const snapshotResult = await db
      .from('container_dashboard_snapshot')
      .select('payload')
      .order('source_updated_at', { ascending: false })
      .limit(1000)

    if (!snapshotResult.error && (snapshotResult.data?.length ?? 0) > 0) {
      rows = (snapshotResult.data ?? []).map((snapshot: { payload: Row }) => snapshot.payload)
    } else if (snapshotResult.error) {
      // The migration is optional during rollout. Avoid repeatedly probing a
      // missing table while keeping the existing live query path operational.
      snapshotUnavailableUntil = Date.now() + 300_000
    }
  }

  if (!rows) {
    const [containerResult, warehouseResult, entryResult, vendorDocResult] = await Promise.all([
      db.from('Container').select(CONTAINER_LIST_COLUMNS).order('updatedAt', { ascending: false }).limit(1000),
      db.from('Warehouse').select('id,name'),
      db.from('ContainerDocEntry').select('id,containerId').limit(1000),
      db.from('ContainerDocVendor').select('entryId,status').limit(1000),
    ])
    if (containerResult.error) throw containerResult.error
    if (warehouseResult.error) throw warehouseResult.error
    if (entryResult.error) throw entryResult.error
    if (vendorDocResult.error) throw vendorDocResult.error
    const warehouseNames = new Map(((warehouseResult.data ?? []) as Row[]).map((warehouse) => [text(warehouse, ['id']), text(warehouse, ['name'])]))
    const statusesByEntry = new Map<string, string[]>()
    for (const vendor of (vendorDocResult.data ?? []) as Row[]) {
      const entryId = text(vendor, ['entryId'])
      statusesByEntry.set(entryId, [...(statusesByEntry.get(entryId) ?? []), text(vendor, ['status'], 'DOCS_PENDING')])
    }
    const statusesByContainer = new Map<string, string[]>()
    for (const entry of (entryResult.data ?? []) as Row[]) {
      const containerId = text(entry, ['containerId'])
      if (!containerId) continue
      statusesByContainer.set(containerId, [...(statusesByContainer.get(containerId) ?? []), ...(statusesByEntry.get(text(entry, ['id'])) ?? ['DOCS_PENDING'])])
    }
    rows = ((containerResult.data ?? []) as Row[]).map((row) => {
      const statuses = statusesByContainer.get(text(row, ['id'])) ?? ['DOCS_PENDING']
      const docsStatus = statuses.reduce((current, candidate) => (DOC_STATUS_RANK[candidate] ?? 0) < (DOC_STATUS_RANK[current] ?? 0) ? candidate : current)
      return { ...row, warehouseName: warehouseNames.get(text(row, ['warehouseId'])) ?? undefined, docsStatus }
    })
  }
  const byContainerNumber = new Map<string, Row[]>()
  for (const row of rows) {
    const number = text(row, ['containerName', 'containerNumber', 'number'], 'Untitled container')
    byContainerNumber.set(number, [...(byContainerNumber.get(number) ?? []), row])
  }
  const containers = sortContainers([...byContainerNumber.values()].map(mergeContainerRows))
  const archived = sortArchivedContainers(containers.filter((container) => ['CLOSED', 'PUTAWAY COMPLETE', 'DELIVERED'].includes(container.status.toUpperCase())))
  const value = { containers: containers.filter((container) => !archived.includes(container)), archived }
  listCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

const getCachedContainers = unstable_cache(loadContainersFromDatabase, ['containers-list-v1'], {
  revalidate: 60,
  tags: ['containers-list'],
})

export async function getContainers({ fresh = false }: { fresh?: boolean } = {}): Promise<ContainerListResult> {
  if (!fresh && listCache && listCache.expiresAt > Date.now()) return listCache.value
  if (fresh) {
    snapshotUnavailableUntil = 0
    return loadContainersFromDatabase()
  }
  const value = await getCachedContainers()
  listCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

export async function getContainerDocumentation({ fresh = false }: { fresh?: boolean } = {}): Promise<ContainerDocumentationRow[]> {
  if (!fresh && documentationCache && documentationCache.expiresAt > Date.now()) return documentationCache.value

  const db = createAdminClient()
  const [entryResult, vendorResult, vendorNameResult, warehouseResult, documentResult, photoResult, emailResult] = await Promise.all([
    db.from('ContainerDocEntry').select('id,containerNumber,containerId,warehouseId,loadingDate,shippingLine,destinationPort,freightForwarder,isSubmitted,submittedAt,arrivalNoticeAt,scUploadCompletedAt,updatedAt').order('updatedAt', { ascending: false }).limit(1000),
    db.from('ContainerDocVendor').select('id,entryId,vendorId,status,reviewedAt,customsClearedAt').limit(1000),
    db.from('Vendor').select('id,name').limit(1000),
    db.from('Warehouse').select('id,name').limit(1000),
    db.from('ContainerDocument').select('id,containerDocVendorId').limit(1000),
    db.from('ContainerDeparturePhoto').select('id,containerDocVendorId').limit(1000),
    db.from('EmailQueue').select('id,relatedId,status,type,queuedAt').eq('relatedType', 'ContainerDocEntry').order('queuedAt', { ascending: false }).limit(2000),
  ])
  for (const result of [entryResult, vendorResult, vendorNameResult, warehouseResult, documentResult, photoResult, emailResult]) {
    if (result.error) throw result.error
  }

  const vendorNames = new Map(((vendorNameResult.data ?? []) as Row[]).map((vendor) => [text(vendor, ['id']), text(vendor, ['name'], 'Unknown vendor')]))
  const warehouseNames = new Map(((warehouseResult.data ?? []) as Row[]).map((warehouse) => [text(warehouse, ['id']), text(warehouse, ['name'], '—')]))
  const documentCounts = new Map<string, number>()
  const photoCounts = new Map<string, number>()
  const invitationStatuses = new Map<string, string>()
  for (const email of (emailResult.data ?? []) as Row[]) {
    const entryId = text(email, ['relatedId'])
    if (entryId && !invitationStatuses.has(entryId) && text(email, ['type']).includes('overseas_doc')) {
      invitationStatuses.set(entryId, text(email, ['status']).toLowerCase())
    }
  }
  for (const document of (documentResult.data ?? []) as Row[]) {
    const vendorId = text(document, ['containerDocVendorId'])
    documentCounts.set(vendorId, (documentCounts.get(vendorId) ?? 0) + 1)
  }
  for (const photo of (photoResult.data ?? []) as Row[]) {
    const vendorId = text(photo, ['containerDocVendorId'])
    photoCounts.set(vendorId, (photoCounts.get(vendorId) ?? 0) + 1)
  }

  const vendorsByEntry = new Map<string, ContainerDocumentationVendor[]>()
  for (const vendor of (vendorResult.data ?? []) as Row[]) {
    const entryId = text(vendor, ['entryId'])
    const vendorRow: ContainerDocumentationVendor = {
      id: text(vendor, ['id']),
      name: vendorNames.get(text(vendor, ['vendorId'])) ?? 'Unknown vendor',
      status: text(vendor, ['status'], 'DOCS_PENDING'),
      documentCount: documentCounts.get(text(vendor, ['id'])) ?? 0,
      photoCount: photoCounts.get(text(vendor, ['id'])) ?? 0,
      reviewedAt: dateValue(vendor, ['reviewedAt']),
      customsClearedAt: dateValue(vendor, ['customsClearedAt']),
    }
    vendorsByEntry.set(entryId, [...(vendorsByEntry.get(entryId) ?? []), vendorRow])
  }

  const value = ((entryResult.data ?? []) as Row[]).map((entry) => {
    const vendors = vendorsByEntry.get(text(entry, ['id'])) ?? []
    const status = vendors.length
      ? vendors.reduce((current, vendor) => (DOC_STATUS_RANK[vendor.status] ?? 0) < (DOC_STATUS_RANK[current] ?? 0) ? vendor.status : current, vendors[0].status)
      : 'DOCS_PENDING'
    return {
      id: text(entry, ['id']),
      containerId: dateValue(entry, ['containerId']),
      containerNumber: dateValue(entry, ['containerNumber']),
      warehouse: warehouseNames.get(text(entry, ['warehouseId'])) ?? '—',
      loadingDate: dateValue(entry, ['loadingDate']),
      shippingLine: text(entry, ['shippingLine'], '—'),
      destinationPort: text(entry, ['destinationPort'], '—'),
      freightForwarder: text(entry, ['freightForwarder'], '—'),
      isSubmitted: Boolean(entry.isSubmitted),
      submittedAt: dateValue(entry, ['submittedAt']),
      arrivalNoticeAt: dateValue(entry, ['arrivalNoticeAt']),
      scUploadCompletedAt: dateValue(entry, ['scUploadCompletedAt']),
      updatedAt: dateValue(entry, ['updatedAt']),
      invitationStatus: invitationStatuses.get(text(entry, ['id'])) ?? null,
      status,
      documentCount: vendors.reduce((total, vendor) => total + vendor.documentCount, 0),
      photoCount: vendors.reduce((total, vendor) => total + vendor.photoCount, 0),
      vendors,
    }
  })

  documentationCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

export async function getContainerPayments({ fresh = false }: { fresh?: boolean } = {}): Promise<ContainerPaymentsResult> {
  if (!fresh && paymentsCache && paymentsCache.expiresAt > Date.now()) return paymentsCache.value

  const db = createAdminClient()
  const [costResult, freightResult, vendorResult, entryResult, vendorNameResult, warehouseResult] = await Promise.all([
    db.from('ContainerCost').select('id,containerDocVendorId,totalCost,paymentTerms,paymentDueDate,warehouseId,isPaid,paidAt,paymentScreenshotName,updatedAt').order('updatedAt', { ascending: false }).limit(1000),
    db.from('ContainerDocFreight').select('id,entryId,freightCost,freightForwarder,updatedAt').order('updatedAt', { ascending: false }).limit(1000),
    db.from('ContainerDocVendor').select('id,entryId,vendorId').limit(1000),
    db.from('ContainerDocEntry').select('id,containerNumber').limit(1000),
    db.from('Vendor').select('id,name').limit(1000),
    db.from('Warehouse').select('id,name').limit(1000),
  ])
  for (const result of [costResult, freightResult, vendorResult, entryResult, vendorNameResult, warehouseResult]) {
    if (result.error) throw result.error
  }

  const vendors = new Map(((vendorResult.data ?? []) as Row[]).map((vendor) => [text(vendor, ['id']), vendor]))
  const entries = new Map(((entryResult.data ?? []) as Row[]).map((entry) => [text(entry, ['id']), entry]))
  const vendorNames = new Map(((vendorNameResult.data ?? []) as Row[]).map((vendor) => [text(vendor, ['id']), text(vendor, ['name'], 'Unknown vendor')]))
  const warehouseNames = new Map(((warehouseResult.data ?? []) as Row[]).map((warehouse) => [text(warehouse, ['id']), text(warehouse, ['name'], '—')]))

  const costs = ((costResult.data ?? []) as Row[]).map((cost): ContainerPaymentRow => {
    const vendor = vendors.get(text(cost, ['containerDocVendorId'])) ?? {}
    const entryId = text(vendor, ['entryId'])
    const entry = entries.get(entryId) ?? {}
    return {
      id: text(cost, ['id']),
      entryId,
      containerNumber: text(entry, ['containerNumber'], 'Untitled container'),
      vendor: vendorNames.get(text(vendor, ['vendorId'])) ?? 'Unknown vendor',
      warehouse: warehouseNames.get(text(cost, ['warehouseId'])) ?? '—',
      totalCost: numeric(cost, ['totalCost']),
      paymentTerms: text(cost, ['paymentTerms'], '—'),
      paymentDueDate: dateValue(cost, ['paymentDueDate']),
      isPaid: Boolean(cost.isPaid),
      paidAt: dateValue(cost, ['paidAt']),
      paymentScreenshotName: text(cost, ['paymentScreenshotName']),
      updatedAt: dateValue(cost, ['updatedAt']),
    }
  })
  const freight = ((freightResult.data ?? []) as Row[]).map((row): ContainerFreightRow => {
    const entryId = text(row, ['entryId'])
    return {
      id: text(row, ['id']),
      entryId,
      containerNumber: text(entries.get(entryId) ?? {}, ['containerNumber'], 'Untitled container'),
      freightCost: numeric(row, ['freightCost']),
      freightForwarder: text(row, ['freightForwarder'], '—'),
      updatedAt: dateValue(row, ['updatedAt']),
    }
  })

  const value = { costs, freight }
  paymentsCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

export async function getContainerDocumentationDetail(entryId: string): Promise<ContainerDocumentationDetail | null> {
  const db = createAdminClient()
  const { data: entryData, error: entryError } = await db.from('ContainerDocEntry').select('*').eq('id', entryId).maybeSingle()
  if (entryError) throw entryError
  if (!entryData) return null
  const entry = entryData as Row

  const [vendorResult, vendorNameResult, warehouseResult, userResult, freightResult, warehousePhotoResult, activityResult, emailResult] = await Promise.all([
    db.from('ContainerDocVendor').select('*').eq('entryId', entryId).order('createdAt', { ascending: true }),
    db.from('Vendor').select('id,name,email').limit(1000),
    db.from('Warehouse').select('id,name').order('name', { ascending: true }).limit(1000),
    db.from('User').select('id,name,email,role').limit(1000),
    db.from('ContainerDocFreight').select('*').eq('entryId', entryId).maybeSingle(),
    db.from('ContainerWarehousePhoto').select('id,type,fileName,fileSize,uploadedByName,uploadedAt').eq('entryId', entryId).order('uploadedAt', { ascending: true }),
    db.from('ContainerDocActivity').select('id,vendorDocId,action,actor,details,createdAt').eq('entryId', entryId).order('createdAt', { ascending: false }).limit(250),
    db.from('EmailQueue').select('id,type,status,subject,queuedAt,sentAt').eq('relatedId', entryId).order('queuedAt', { ascending: false }).limit(1),
  ])
  for (const result of [vendorResult, vendorNameResult, warehouseResult, userResult, freightResult, warehousePhotoResult, activityResult, emailResult]) {
    if (result.error) throw result.error
  }

  const vendorRows = (vendorResult.data ?? []) as Row[]
  const vendorDocIds = vendorRows.map((vendor) => text(vendor, ['id'])).filter(Boolean)
  const [documentResult, departurePhotoResult, costResult] = vendorDocIds.length ? await Promise.all([
    db.from('ContainerDocument').select('id,containerDocVendorId,type,fileName,fileSize,uploadedAt').in('containerDocVendorId', vendorDocIds).order('uploadedAt', { ascending: true }),
    db.from('ContainerDeparturePhoto').select('id,containerDocVendorId,fileName,fileSize,caption,uploadedAt').in('containerDocVendorId', vendorDocIds).order('uploadedAt', { ascending: true }),
    db.from('ContainerCost').select('id,containerDocVendorId,totalCost,paymentTerms,paymentDueDate,isPaid,paidAt,paymentScreenshotName').in('containerDocVendorId', vendorDocIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  for (const result of [documentResult, departurePhotoResult, costResult]) if (result.error) throw result.error

  const vendorNames = new Map(((vendorNameResult.data ?? []) as Row[]).map((vendor) => [text(vendor, ['id']), text(vendor, ['name'], 'Unknown vendor')]))
  const warehouses = ((warehouseResult.data ?? []) as Row[]).map((warehouse) => ({ id: text(warehouse, ['id']), name: text(warehouse, ['name'], '—') }))
  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]))
  const userRows = (userResult.data ?? []) as Row[]
  const users = new Map(userRows.map((user) => [text(user, ['id']), user]))
  const documents = (documentResult.data ?? []) as Row[]
  const photos = (departurePhotoResult.data ?? []) as Row[]
  const costs = new Map(((costResult.data ?? []) as Row[]).map((cost) => [text(cost, ['containerDocVendorId']), cost]))

  const vendors = vendorRows.map((vendor) => {
    const vendorDocId = text(vendor, ['id'])
    const reviewer = users.get(text(vendor, ['reviewedById']))
    const cost = costs.get(vendorDocId)
    return {
      id: vendorDocId,
      vendorId: text(vendor, ['vendorId']),
      name: vendorNames.get(text(vendor, ['vendorId'])) ?? 'Unknown vendor',
      status: text(vendor, ['status'], 'DOCS_PENDING'),
      reviewedBy: reviewer ? text(reviewer, ['name', 'email']) : '',
      reviewedAt: dateValue(vendor, ['reviewedAt']),
      reviewNotes: text(vendor, ['reviewNotes']),
      isfConfirmed: Boolean(vendor.isfConfirmed),
      customsClearedAt: dateValue(vendor, ['customsClearedAt']),
      documents: documents.filter((document) => text(document, ['containerDocVendorId']) === vendorDocId).map((document) => ({
        id: text(document, ['id']),
        type: text(document, ['type'], 'OTHER'),
        fileName: text(document, ['fileName'], 'Document'),
        fileSize: numeric(document, ['fileSize']),
        uploadedAt: dateValue(document, ['uploadedAt']),
      })),
      photos: photos.filter((photo) => text(photo, ['containerDocVendorId']) === vendorDocId).map((photo) => ({
        id: text(photo, ['id']),
        fileName: text(photo, ['fileName'], 'Photo'),
        fileSize: numeric(photo, ['fileSize']),
        caption: text(photo, ['caption']),
        uploadedAt: dateValue(photo, ['uploadedAt']),
      })),
      cost: cost ? {
        id: text(cost, ['id']),
        totalCost: numeric(cost, ['totalCost']),
        paymentTerms: text(cost, ['paymentTerms'], '—'),
        paymentDueDate: dateValue(cost, ['paymentDueDate']),
        isPaid: Boolean(cost.isPaid),
        paidAt: dateValue(cost, ['paidAt']),
        paymentScreenshotName: text(cost, ['paymentScreenshotName']),
      } : null,
    }
  })
  const overallStatus = vendors.length
    ? vendors.reduce((current, vendor) => (DOC_STATUS_RANK[vendor.status] ?? 0) < (DOC_STATUS_RANK[current] ?? 0) ? vendor.status : current, vendors[0].status)
    : 'DOCS_PENDING'
  const overseasRep = users.get(text(entry, ['overseasRepId']))
  const freight = freightResult.data as Row | null
  const latestEmail = ((emailResult.data ?? []) as Row[])[0]

  return {
    id: text(entry, ['id']),
    containerId: dateValue(entry, ['containerId']),
    containerNumber: text(entry, ['containerNumber'], 'Untitled container'),
    loadingDate: dateValue(entry, ['loadingDate']),
    shippingLine: text(entry, ['shippingLine'], '—'),
    destinationPort: text(entry, ['destinationPort'], '—'),
    freightForwarder: text(entry, ['freightForwarder'], '—'),
    warehouseId: dateValue(entry, ['warehouseId']),
    warehouse: warehouseNames.get(text(entry, ['warehouseId'])) ?? '—',
    overseasRepId: dateValue(entry, ['overseasRepId']),
    overseasRep: overseasRep ? text(overseasRep, ['name', 'email']) : '—',
    isSubmitted: Boolean(entry.isSubmitted),
    submittedAt: dateValue(entry, ['submittedAt']),
    arrivalNotice: Boolean(entry.arrivalNotice),
    arrivalNoticeAt: dateValue(entry, ['arrivalNoticeAt']),
    scUploadCompletedAt: dateValue(entry, ['scUploadCompletedAt']),
    status: overallStatus,
    vendors,
    freight: freight ? {
      id: text(freight, ['id']),
      freightCost: numeric(freight, ['freightCost']),
      freightForwarder: text(freight, ['freightForwarder']),
      updatedAt: dateValue(freight, ['updatedAt']),
    } : null,
    warehousePhotos: ((warehousePhotoResult.data ?? []) as Row[]).map((photo) => ({
      id: text(photo, ['id']),
      type: text(photo, ['type']),
      fileName: text(photo, ['fileName'], 'Warehouse photo'),
      fileSize: numeric(photo, ['fileSize']),
      uploadedByName: text(photo, ['uploadedByName']),
      uploadedAt: dateValue(photo, ['uploadedAt']),
    })),
    activity: ((activityResult.data ?? []) as Row[]).map((activity) => ({
      id: text(activity, ['id']),
      vendorDocId: dateValue(activity, ['vendorDocId']),
      action: text(activity, ['action']),
      actor: text(activity, ['actor'], 'System'),
      details: activity.details && typeof activity.details === 'object' && !Array.isArray(activity.details) ? activity.details as Row : null,
      createdAt: dateValue(activity, ['createdAt']),
    })),
    latestEmail: latestEmail ? {
      id: text(latestEmail, ['id']),
      type: text(latestEmail, ['type']),
      status: text(latestEmail, ['status']),
      subject: text(latestEmail, ['subject']),
      queuedAt: dateValue(latestEmail, ['queuedAt']),
      sentAt: dateValue(latestEmail, ['sentAt']),
    } : null,
    warehouses,
    overseasReps: userRows.filter((user) => ['OVERSEAS', 'OVERSEAS_REP'].includes(text(user, ['role']))).map((user) => ({
      id: text(user, ['id']),
      name: text(user, ['name', 'email']),
      email: text(user, ['email']),
    })),
  }
}

async function loadContainerDetailFromDatabase(containerNumber: string): Promise<ContainerDetail | null> {
  const db = createAdminClient()
  let rowsWithWarehouse: Row[] | null = null

  if (snapshotUnavailableUntil <= Date.now()) {
    const snapshotResult = await db
      .from('container_dashboard_snapshot')
      .select('payload')
      .eq('container_number', containerNumber)
      .limit(50)

    if (!snapshotResult.error) {
      rowsWithWarehouse = (snapshotResult.data ?? []).map((snapshot: { payload: Row }) => snapshot.payload)
    } else {
      snapshotUnavailableUntil = Date.now() + 300_000
    }
  }

  if (!rowsWithWarehouse) {
    const [containerResult, warehouseResult] = await Promise.all([
      db.from('Container').select('*').eq('containerName', containerNumber),
      db.from('Warehouse').select('id,name'),
    ])
    if (containerResult.error) throw containerResult.error
    if (warehouseResult.error) throw warehouseResult.error
    const warehouseNames = new Map(((warehouseResult.data ?? []) as Row[]).map((warehouse) => [text(warehouse, ['id']), text(warehouse, ['name'])]))
    rowsWithWarehouse = ((containerResult.data ?? []) as Row[]).map((row) => ({ ...row, warehouseName: warehouseNames.get(text(row, ['warehouseId'])) ?? undefined }))
  }

  if (!rowsWithWarehouse.length) return null
  const containerIds = rowsWithWarehouse.map((row) => text(row, ['id'])).filter(Boolean)
  const [itemsResult, milestonesResult, truckingResult, docsResult] = await Promise.all([
    db.from('ContainerItem').select('*').in('containerId', containerIds),
    db.from('ContainerMilestone').select('*').in('containerId', containerIds),
    db.from('TruckingInfo').select('*').in('containerId', containerIds).limit(1),
    db.from('ContainerDocEntry').select('*').in('containerId', containerIds),
  ])
  for (const result of [itemsResult, milestonesResult, truckingResult, docsResult]) if (result.error) throw result.error
  const docEntries = (docsResult.data ?? []) as Row[]
  const entryIds = docEntries.map((entry) => text(entry, ['id'])).filter(Boolean)
  const items = (itemsResult.data ?? []) as Row[]
  const primary = primaryRow(rowsWithWarehouse)
  const containerWarehouse = text(primary, ['warehouseName'])
  const normalizeSku = (value: string) => value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase()
  const normalizeWarehouse = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedWarehouse = normalizeWarehouse(containerWarehouse)
  const sellercloudWarehouseId = SELLERCLOUD_WAREHOUSE_IDS[normalizedWarehouse] ?? ''
  const inventorySkus = [...new Set(items.map((item) => normalizeSku(text(item, ['sku']))).filter((sku) => sku && sku !== '—'))]
  const vendorPromise = entryIds.length
    ? db.from('ContainerDocVendor').select('*').in('entryId', entryIds)
    : Promise.resolve({ data: [], error: null })
  const inventoryPromise = inventorySkus.length
    ? sellercloudWarehouseId
      ? db.from('inventory').select('sku,warehouse,warehouse_id,product_name,qty_on_hand,qty_available,qty_inbound,synced_at').in('sku', inventorySkus).eq('warehouse_id', sellercloudWarehouseId)
      : db.from('inventory').select('sku,warehouse,warehouse_id,product_name,qty_on_hand,qty_available,qty_inbound,synced_at').in('sku', inventorySkus).eq('warehouse', containerWarehouse)
    : Promise.resolve({ data: [], error: null })
  const [{ data: documentVendors, error: vendorError }, { data: inventoryData, error: inventoryError }] = await Promise.all([vendorPromise, inventoryPromise])
  if (vendorError) throw vendorError
  if (inventoryError) throw inventoryError
  const vendorIds = ((documentVendors ?? []) as Row[]).map((vendor) => text(vendor, ['id'])).filter(Boolean)
  const sourceVendorIds = [...new Set(((documentVendors ?? []) as Row[]).map((vendor) => text(vendor, ['vendorId'])).filter(Boolean))]
  const [documentsResult, photosResult, warehousePhotosResult, vendorNamesResult, costsResult] = await Promise.all([
    vendorIds.length ? db.from('ContainerDocument').select('*').in('containerDocVendorId', vendorIds) : Promise.resolve({ data: [], error: null }),
    vendorIds.length ? db.from('ContainerDeparturePhoto').select('*').in('containerDocVendorId', vendorIds) : Promise.resolve({ data: [], error: null }),
    entryIds.length ? db.from('ContainerWarehousePhoto').select('*').in('entryId', entryIds).order('uploadedAt', { ascending: true }) : Promise.resolve({ data: [], error: null }),
    sourceVendorIds.length ? db.from('Vendor').select('id,name').in('id', sourceVendorIds) : Promise.resolve({ data: [], error: null }),
    vendorIds.length ? db.from('ContainerCost').select('*').in('containerDocVendorId', vendorIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (documentsResult.error || photosResult.error || warehousePhotosResult.error || vendorNamesResult.error || costsResult.error) {
    throw documentsResult.error || photosResult.error || warehousePhotosResult.error || vendorNamesResult.error || costsResult.error
  }
  const vendorNames = new Map(((vendorNamesResult.data ?? []) as Row[]).map((vendor) => [text(vendor, ['id']), text(vendor, ['name'], 'Unknown vendor')]))
  const costsByVendor = new Map(((costsResult.data ?? []) as Row[]).map((cost) => [text(cost, ['containerDocVendorId']), cost]))
  const sellercloudIdsByVendor = new Map<string, string[]>()
  for (const row of rowsWithWarehouse) {
    const vendorId = text(row, ['vendorId'])
    const sellercloudId = text(row, ['sellercloudId'])
    if (vendorId && sellercloudId) sellercloudIdsByVendor.set(vendorId, [...(sellercloudIdsByVendor.get(vendorId) ?? []), sellercloudId])
  }
  const enrichedDocumentVendors = ((documentVendors ?? []) as Row[]).map((vendor) => {
    const vendorId = text(vendor, ['vendorId'])
    return { ...vendor, vendorName: vendorNames.get(vendorId) ?? 'Unknown vendor', sellercloudIds: [...new Set(sellercloudIdsByVendor.get(vendorId) ?? [])], cost: costsByVendor.get(text(vendor, ['id'])) ?? null }
  })
  const inventoryRows = (inventoryData ?? []) as Row[]
  const inventoryBySku = new Map<string, Row>()
  for (const inventory of inventoryRows) {
    const sku = normalizeSku(text(inventory, ['sku']))
    const matchesWarehouseId = sellercloudWarehouseId && text(inventory, ['warehouse_id']) === sellercloudWarehouseId
    const matchesWarehouseName = normalizedWarehouse && normalizeWarehouse(text(inventory, ['warehouse'])) === normalizedWarehouse
    if (matchesWarehouseId || matchesWarehouseName) inventoryBySku.set(sku, inventory)
  }
  const itemsBySku = new Map<string, { sku: string; productName: string; incoming: number }>()
  for (const item of items) {
    const sku = normalizeSku(text(item, ['sku']))
    if (!sku) continue
    const current = itemsBySku.get(sku) ?? { sku, productName: text(item, ['productName'], sku), incoming: 0 }
    current.incoming += Math.max(0, numeric(item, ['quantity']) - numeric(item, ['receivedQty']))
    if (!current.productName || current.productName === sku) current.productName = text(item, ['productName'], sku)
    itemsBySku.set(sku, current)
  }
  const priorityRestock = [...itemsBySku.values()].flatMap((item) => {
    const sku = item.sku
    const inventory = inventoryBySku.get(sku)
    if (!inventory) return []
    const onHand = numeric(inventory, ['qty_available'])
    const incoming = item.incoming
    if (onHand >= 10 || incoming === 0) return []
    return [{
      sku,
      productName: item.productName || text(inventory, ['product_name'], sku),
      status: onHand <= 0 ? 'Out of Stock' as const : 'Low Stock' as const,
      onHand,
      inTransit: incoming,
      incoming,
    }]
  }).sort((left, right) => left.onHand - right.onHand)
  const inventorySyncedAt = inventoryRows.map((row) => dateValue(row, ['synced_at'])).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
  const scByContainerId = new Map(rowsWithWarehouse.map((row) => [text(row, ['id']), text(row, ['sellercloudId'], '—')]))
  const entries = new Map<string, Row[]>()
  for (const item of items) {
    const scId = scByContainerId.get(text(item, ['containerId'])) ?? '—'
    entries.set(scId, [...(entries.get(scId) ?? []), item])
  }
  const scEntries = [...entries.entries()].map(([id, entryItems]) => ({
    id,
    vendor: text(entryItems[0], ['vendorName'], 'Unknown vendor'),
    itemCount: entryItems.length,
    quantity: entryItems.reduce((total, item) => total + numeric(item, ['quantity']), 0),
    receivedQuantity: entryItems.reduce((total, item) => total + numeric(item, ['receivedQty']), 0),
    items: entryItems,
  })).sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
  const uniqueMilestones = [...new Map(((milestonesResult.data ?? []) as Row[]).map((milestone) => [`${text(milestone, ['milestone'])}|${text(milestone, ['location'])}|${text(milestone, ['date'])}`, milestone])).values()].sort((left, right) => text(left, ['date']).localeCompare(text(right, ['date'])))
  const value = { ...mergeContainerRows(rowsWithWarehouse), raw: primary, items, scEntries, milestones: uniqueMilestones, tracking: { origin: text(primary, ['portOfLoading'], 'Origin port'), destination: text(primary, ['portOfDischarge', 'portName'], 'Destination port'), latitude: first(primary, ['currentLatitude']) === null ? null : numeric(primary, ['currentLatitude']), longitude: first(primary, ['currentLongitude']) === null ? null : numeric(primary, ['currentLongitude']), status: text(primary, ['shipsgoStatus', 'status'], 'PENDING'), eta: dateValue(primary, ['shipsgoEta', 'etaPort', 'estimatedArrivalDate']), vessel: text(primary, ['vesselName', 'vesselNumber']), carrier: text(primary, ['shippingLine']), transitDays: first(primary, ['transitTime']) === null ? null : numeric(primary, ['transitTime']) }, trucking: ((truckingResult.data ?? [])[0] as Row | undefined) ?? null, documentation: docEntries, documentVendors: enrichedDocumentVendors, documents: (documentsResult.data ?? []) as Row[], departurePhotos: (photosResult.data ?? []) as Row[], warehousePhotos: (warehousePhotosResult.data ?? []) as Row[], priorityRestock, inventorySyncedAt }
  return value
}

function getCachedContainerDetail(containerNumber: string) {
  return unstable_cache(
    () => loadContainerDetailFromDatabase(containerNumber),
    ['container-detail-v1', containerNumber],
    { revalidate: 300, tags: ['container-details'] },
  )()
}

export async function getContainerDetail(containerNumber: string): Promise<ContainerDetail | null> {
  const cached = detailCache.get(containerNumber)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = await getCachedContainerDetail(containerNumber)
  detailCache.set(containerNumber, { value, expiresAt: Date.now() + 5 * 60_000 })
  return value
}
