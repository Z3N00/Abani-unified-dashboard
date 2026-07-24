import 'server-only'

type SellercloudInventoryItem = {
  ID?: string | number
  ProductID?: string
  ProductName?: string
  WarehouseID?: string | number
  WarehouseName?: string
  Warehouse?: string
  PhysicalQty?: number
  AvailableQty?: number
  InventoryAvailableQty?: number
  WarehouseReservedQty?: number
  WarehousePhysicalQty?: number
  ReservedQty?: number
  OnOrder?: number
  OnOrderQty?: number
  QtySold30?: number
  QtySold60?: number
}

type InventoryPage = { Items?: SellercloudInventoryItem[]; TotalResults?: number }

const WAREHOUSE_NAMES: Record<string, string> = {
  '161': 'NFI - WH1',
  '162': 'Interim Warehouse',
  '163': 'FBA Warehouse',
  '165': 'Abani Canada',
  '167': 'Deringer - WH2',
  '262': 'DYN - WH3',
  '274': 'JAX - WH4',
  '330': 'TX - WH5',
  '351': 'CA-WH6',
  '352': 'CA-WH7',
  '353': 'NJ - WH8',
  '354': 'PA - WH9',
}

const REQUEST_TIMEOUT_MS = 45_000
let token: string | null = null

function config() {
  const username = process.env.SELLERCLOUD_USER?.trim()
  const password = process.env.SELLERCLOUD_PASS?.trim()
  if (!username || !password) throw new Error('Sellercloud credentials are not configured.')
  return {
    username,
    password,
    companyId: process.env.SELLERCLOUD_COMPANY_ID?.trim() || '204',
    baseUrl: (process.env.SELLERCLOUD_BASE_URL?.trim() || 'https://aq.api.sellercloud.com/rest').replace(/\/$/, ''),
  }
}

async function request(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timeout)
  }
}

async function accessToken() {
  if (token) return token
  const current = config()
  const response = await request(`${current.baseUrl}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Username: current.username, Password: current.password }),
  })
  if (!response.ok) throw new Error(`Sellercloud authentication failed (${response.status}).`)
  const data = await response.json() as { access_token?: string; token?: string }
  token = data.access_token ?? data.token ?? null
  if (!token) throw new Error('Sellercloud authentication returned no access token.')
  return token
}

async function getInventoryPage(pageNumber: number, pageSize: number) {
  const current = config()
  const url = new URL(`${current.baseUrl}/api/inventory`)
  url.searchParams.set('pageNumber', String(pageNumber))
  url.searchParams.set('pageSize', String(pageSize))
  url.searchParams.set('companyID', current.companyId)
  let response = await request(url.toString(), { headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' } })
  if (response.status === 401) {
    token = null
    response = await request(url.toString(), { headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' } })
  }
  if (!response.ok) throw new Error(`Sellercloud inventory request failed (${response.status}).`)
  return response.json() as Promise<InventoryPage>
}

async function getProductWarehouses(productId: string) {
  const current = config()
  const url = new URL(`${current.baseUrl}/api/Inventory/Warehouses`)
  url.searchParams.set('productID', productId)
  let response = await request(url.toString(), { headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' } })
  if (response.status === 401) {
    token = null
    response = await request(url.toString(), { headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' } })
  }
  if (!response.ok) throw new Error(`Sellercloud warehouse inventory request failed for ${productId} (${response.status}).`)
  const data = await response.json() as SellercloudInventoryItem[] | SellercloudInventoryItem | { Items?: SellercloudInventoryItem[] }
  if (Array.isArray(data)) return data
  if ('Items' in data && Array.isArray(data.Items)) return data.Items
  return [data as SellercloudInventoryItem]
}

export type InventoryCacheRow = {
  sku: string; warehouse: string; warehouse_id: string; product_name: string
  qty_on_hand: number; qty_available: number; qty_reserved: number; qty_inbound: number
  sold_30: number; velocity_30d: number; days_of_stock: number; synced_at: string; updated_at: string; source_data: SellercloudInventoryItem
}

function number(value: unknown) { return Number(value ?? 0) || 0 }

function normalize(item: SellercloudInventoryItem, now: string): InventoryCacheRow | null {
  const sku = String(item.ID ?? item.ProductID ?? '').trim()
  if (!sku || /^\d+$/.test(sku)) return null
  const warehouseId = String(item.WarehouseID ?? '').trim()
  const warehouse = String(item.WarehouseName ?? item.Warehouse ?? (warehouseId ? `WH-${warehouseId}` : 'Main')).trim() || 'Main'
  const onHand = number(item.PhysicalQty)
  const available = number(item.InventoryAvailableQty ?? item.AvailableQty ?? item.PhysicalQty)
  const sold30 = number(item.QtySold30)
  const sold60 = number(item.QtySold60)
  const velocity = sold30 > 0 ? sold30 / 30 : sold60 > 0 ? sold60 / 60 : 0
  return { sku, warehouse, warehouse_id: warehouseId, product_name: String(item.ProductName ?? ''), qty_on_hand: onHand, qty_available: available, qty_reserved: number(item.WarehouseReservedQty ?? item.ReservedQty), qty_inbound: number(item.OnOrderQty ?? item.OnOrder), sold_30: sold30, velocity_30d: velocity, days_of_stock: velocity > 0 ? available / velocity : available > 0 ? 999 : 0, synced_at: now, updated_at: now, source_data: item }
}

function normalizeWarehouse(item: SellercloudInventoryItem, fallbackSku: string, now: string): InventoryCacheRow {
  const sku = String(item.ProductID ?? fallbackSku ?? item.ID ?? '').trim() || fallbackSku
  const warehouseId = String(item.WarehouseID ?? '').trim()
  const warehouse = String(WAREHOUSE_NAMES[warehouseId] ?? item.WarehouseName ?? item.Warehouse ?? (warehouseId ? `WH-${warehouseId}` : 'Main')).trim() || 'Main'
  const reserved = number(item.WarehouseReservedQty ?? item.ReservedQty)
  const onHand = number(item.PhysicalQty ?? item.WarehousePhysicalQty)
  const available = number(item.InventoryAvailableQty ?? item.AvailableQty ?? Math.max(onHand - reserved, 0))
  const sold30 = number(item.QtySold30)
  const sold60 = number(item.QtySold60)
  const velocity = sold30 > 0 ? sold30 / 30 : sold60 > 0 ? sold60 / 60 : 0
  return { sku, warehouse, warehouse_id: warehouseId, product_name: String(item.ProductName ?? ''), qty_on_hand: onHand, qty_available: available, qty_reserved: reserved, qty_inbound: number(item.OnOrderQty ?? item.OnOrder), sold_30: sold30, velocity_30d: velocity, days_of_stock: velocity > 0 ? available / velocity : available > 0 ? 999 : 0, synced_at: now, updated_at: now, source_data: item }
}

/** Fetches Sellercloud inventory server-side. Call only from a scheduled/admin sync, never from a page render. */
export async function fetchInventoryCacheBatch(startPage = 1, maxPages = 10): Promise<{ rows: InventoryCacheRow[]; nextPage: number | null }> {
  const rows: InventoryCacheRow[] = []
  const pageSize = 50
  const now = new Date().toISOString()
  let fetched = 0
  let totalResults: number | null = null
  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const result = await getInventoryPage(page, pageSize)
    const items = result.Items ?? []
    totalResults = result.TotalResults ?? totalResults
    rows.push(...items.map((item) => normalize(item, now)).filter((item): item is InventoryCacheRow => item !== null))
    fetched += 1
    if (items.length === 0 || page * pageSize >= (totalResults ?? Number.POSITIVE_INFINITY)) return { rows, nextPage: null }
  }
  const nextPage = totalResults !== null && (startPage + fetched - 1) * pageSize >= totalResults ? null : startPage + fetched
  return { rows, nextPage }
}

/** Refreshes the warehouse-level inventory needed by one container without scanning the full catalog. */
export async function fetchInventoryForProducts(productIds: string[]): Promise<InventoryCacheRow[]> {
  const uniqueIds = [...new Set(productIds.map((value) => value.trim()).filter(Boolean))]
  const now = new Date().toISOString()
  const rows: InventoryCacheRow[] = []
  const concurrency = 6
  for (let start = 0; start < uniqueIds.length; start += concurrency) {
    const productBatch = uniqueIds.slice(start, start + concurrency)
    const results = await Promise.all(productBatch.map(async (productId) => {
      const warehouses = await getProductWarehouses(productId)
      return warehouses.map((item) => normalizeWarehouse(item, productId, now))
    }))
    rows.push(...results.flat())
  }
  return [...new Map(rows.map((row) => [`${row.sku}\u0000${row.warehouse}`, row])).values()]
}
