import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSlackMessage, slackChannelForWarehouse } from '@/lib/slack/send'

type Row = Record<string, unknown>
type Job = 'reminders' | 'summary'

const DAY_MS = 86_400_000

function stringValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateOnly(value: unknown) {
  const text = stringValue(value)
  return text ? text.slice(0, 10) : ''
}

function todayInNewYork(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function displayDate(value: string) {
  if (!value) return 'N/A'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function displayLongDate(value: string) {
  if (!value) return 'N/A'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS)
}

function businessDayDifference(from: string, to: string) {
  const direction = from <= to ? 1 : -1
  const cursor = new Date(`${from}T12:00:00Z`)
  const destination = new Date(`${to}T12:00:00Z`)
  let count = 0
  while (cursor.getTime() !== destination.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + direction)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += direction
  }
  return count
}

function notificationId() {
  return `notification_${crypto.randomUUID()}`
}

function appUrl(path: string) {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}${path}` : ''
}

type ContainerNotificationRecord = {
  id: string
  number: string
  status: string
  warehouse: string
  warehouseChannel: string | null
  carrier: string
  vessel: string
  eta: string
  deliveryDate: string
  actualDeliveryDate: string
  deliveredAt: string
  putawayDeadline: string
  putawayCompletedAt: string
  loadType: string
  quantity: number
  received: number
  sellercloudIds: string[]
}

async function loadContainerRecords(): Promise<ContainerNotificationRecord[]> {
  const db = createAdminClient()
  const [containersResult, warehousesResult, truckingResult] = await Promise.all([
    db.from('Container').select('id,containerName,status,shipsgoStatus,warehouseId,shippingLine,vesselName,etaPort,estimatedArrivalDate,shipsgoEta,totalQty,totalReceived,sellercloudId,deliveredToWarehouseAt,putawayDeadline,putawayCompletedAt'),
    db.from('Warehouse').select('id,name,slackChannelId'),
    db.from('TruckingInfo').select('containerId,truckingCompany,carrier,deliveryDate,actualDeliveryDate,loadType'),
  ])
  if (containersResult.error || warehousesResult.error || truckingResult.error) {
    throw containersResult.error || warehousesResult.error || truckingResult.error
  }

  const warehouses = new Map((warehousesResult.data ?? []).map((row) => [stringValue(row.id), row]))
  const trucking = new Map((truckingResult.data ?? []).map((row) => [stringValue(row.containerId), row]))
  const grouped = new Map<string, ContainerNotificationRecord>()

  for (const row of (containersResult.data ?? []) as Row[]) {
    const number = stringValue(row.containerName).trim().toUpperCase()
    if (!number) continue
    const warehouse = warehouses.get(stringValue(row.warehouseId)) as Row | undefined
    const truck = trucking.get(stringValue(row.id)) as Row | undefined
    const existing = grouped.get(number)
    const current: ContainerNotificationRecord = {
      id: stringValue(row.id),
      number,
      status: stringValue(row.shipsgoStatus || row.status || 'PENDING').replaceAll('_', ' ').toUpperCase(),
      warehouse: stringValue(warehouse?.name),
      warehouseChannel: stringValue(warehouse?.slackChannelId) || null,
      carrier: stringValue(truck?.truckingCompany || truck?.carrier || row.shippingLine),
      vessel: stringValue(row.vesselName),
      eta: dateOnly(row.shipsgoEta || row.etaPort || row.estimatedArrivalDate),
      deliveryDate: dateOnly(truck?.deliveryDate),
      actualDeliveryDate: dateOnly(truck?.actualDeliveryDate),
      deliveredAt: dateOnly(row.deliveredToWarehouseAt),
      putawayDeadline: dateOnly(row.putawayDeadline),
      putawayCompletedAt: dateOnly(row.putawayCompletedAt),
      loadType: stringValue(truck?.loadType),
      quantity: numberValue(row.totalQty),
      received: numberValue(row.totalReceived),
      sellercloudIds: stringValue(row.sellercloudId) ? [stringValue(row.sellercloudId)] : [],
    }
    if (!existing) {
      grouped.set(number, current)
      continue
    }
    existing.quantity += current.quantity
    existing.received += current.received
    existing.sellercloudIds.push(...current.sellercloudIds)
    if (!existing.warehouse && current.warehouse) existing.warehouse = current.warehouse
    if (!existing.warehouseChannel && current.warehouseChannel) existing.warehouseChannel = current.warehouseChannel
    if (!existing.deliveryDate && current.deliveryDate) existing.deliveryDate = current.deliveryDate
    if (!existing.actualDeliveryDate && current.actualDeliveryDate) existing.actualDeliveryDate = current.actualDeliveryDate
    if (!existing.deliveredAt && current.deliveredAt) existing.deliveredAt = current.deliveredAt
    if (!existing.putawayDeadline && current.putawayDeadline) existing.putawayDeadline = current.putawayDeadline
    if (!existing.putawayCompletedAt && current.putawayCompletedAt) existing.putawayCompletedAt = current.putawayCompletedAt
    if (!existing.carrier && current.carrier) existing.carrier = current.carrier
    if (!existing.loadType && current.loadType) existing.loadType = current.loadType
  }

  return [...grouped.values()].map((record) => ({
    ...record,
    sellercloudIds: [...new Set(record.sellercloudIds)],
  }))
}

async function existingKeys(types: string[]) {
  const { data, error } = await createAdminClient()
    .from('NotificationLog')
    .select('metadata')
    .in('type', types)
    .eq('success', true)
    .limit(5000)
  if (error) throw error
  return new Set((data ?? []).map((row) => stringValue((row.metadata as Row | null)?.dedupeKey)).filter(Boolean))
}

async function logNotification(input: {
  containerId?: string
  type: 'DELIVERY_ALERT' | 'PUTAWAY_REMINDER' | 'CUSTOM'
  channel: string
  message: string
  dedupeKey: string
  success: boolean
  errorMessage?: string
}) {
  const { error } = await createAdminClient().from('NotificationLog').insert({
    id: notificationId(),
    containerId: input.containerId || null,
    type: input.type,
    channel: input.channel,
    message: input.message,
    metadata: { dedupeKey: input.dedupeKey },
    sentAt: new Date().toISOString(),
    success: input.success,
    errorMessage: input.errorMessage || null,
  })
  if (error) throw error
}

async function deliver(input: {
  record?: ContainerNotificationRecord
  type: 'DELIVERY_ALERT' | 'PUTAWAY_REMINDER' | 'CUSTOM'
  channel: string
  text: string
  blocks: Record<string, unknown>[]
  dedupeKey: string
}) {
  try {
    await sendSlackMessage({ text: input.text, blocks: input.blocks }, input.channel)
    await logNotification({
      containerId: input.record?.id,
      type: input.type,
      channel: input.channel,
      message: input.text,
      dedupeKey: input.dedupeKey,
      success: true,
    })
    return true
  } catch (error) {
    await logNotification({
      containerId: input.record?.id,
      type: input.type,
      channel: input.channel,
      message: input.text,
      dedupeKey: input.dedupeKey,
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Slack send failed.',
    })
    return false
  }
}

function recordUrls(record: ContainerNotificationRecord) {
  const containerUrl = appUrl(`/containers?container=${encodeURIComponent(record.number)}`)
  const photosUrl = appUrl(`/containers?container=${encodeURIComponent(record.number)}&detailTab=documentation#warehouse-arrival-photos`)
  const receiveUrl = appUrl(`/containers/receive/${encodeURIComponent(record.number)}`)
  return { containerUrl, photosUrl, receiveUrl }
}

function actionBlock(elements: Record<string, unknown>[]) {
  return elements.length ? [{ type: 'actions', elements }] : []
}

function deliveryActions(record: ContainerNotificationRecord) {
  const { containerUrl, photosUrl } = recordUrls(record)
  return actionBlock([
    ...(containerUrl ? [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'View Container', emoji: true }, url: containerUrl }] : []),
    ...(photosUrl ? [{ type: 'button', text: { type: 'plain_text', text: '📸 Add Photos', emoji: true }, url: photosUrl }] : []),
  ])
}

function receivingActions(record: ContainerNotificationRecord) {
  const { photosUrl, receiveUrl } = recordUrls(record)
  return actionBlock([
    ...(photosUrl ? [{ type: 'button', text: { type: 'plain_text', text: '📸 Add Photos', emoji: true }, url: photosUrl }] : []),
    ...(receiveUrl ? [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: '✅ Confirm Received', emoji: true }, url: receiveUrl }] : []),
  ])
}

function putawayActions(record: ContainerNotificationRecord) {
  const { photosUrl } = recordUrls(record)
  return actionBlock(photosUrl
    ? [{ type: 'button', text: { type: 'plain_text', text: '📸 Add Photos', emoji: true }, url: photosUrl }]
    : [])
}

async function processReminders(records: ContainerNotificationRecord[], today: string) {
  const keys = await existingKeys(['DELIVERY_ALERT', 'PUTAWAY_REMINDER'])
  let sent = 0

  for (const record of records) {
    const channel = slackChannelForWarehouse(record.warehouse) || record.warehouseChannel
    if (!channel) continue

    if (record.deliveryDate && record.deliveryDate >= today && !record.actualDeliveryDate && !record.deliveredAt) {
      const scheduledKey = `delivery-scheduled:${record.number}:${record.deliveryDate}:${record.carrier}:${record.loadType}`
      if (!keys.has(scheduledKey)) {
        const text = `🚚 Delivery Scheduled — ${record.number}`
        const scheduledDeadline = addBusinessDays(new Date(`${record.deliveryDate}T12:00:00Z`), 5).toISOString().slice(0, 10)
        const didSend = await deliver({
          record,
          type: 'DELIVERY_ALERT',
          channel,
          text,
          dedupeKey: scheduledKey,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text, emoji: true } },
            { type: 'section', fields: [
              { type: 'mrkdwn', text: `*Carrier:*\n${record.carrier || 'Not set'}` },
              { type: 'mrkdwn', text: `*Delivery Date:*\n${displayLongDate(record.deliveryDate)}` },
              { type: 'mrkdwn', text: `*Load Type:*\n${record.loadType || 'Not set'}` },
              { type: 'mrkdwn', text: `*Status:*\n${record.status}` },
              { type: 'mrkdwn', text: `*Total Qty:*\n${record.quantity.toLocaleString('en-US')}` },
              { type: 'mrkdwn', text: `*Putaway Deadline:*\n${displayLongDate(scheduledDeadline).replace(/, \d{4}$/, '')}` },
            ] },
            ...deliveryActions(record),
          ],
        })
        if (didSend) sent += 1
      }

      const arrivalKey = `receiving-reminder:${record.number}:${record.deliveryDate}`
      const hasArrived = Boolean(record.actualDeliveryDate || record.deliveredAt)
      const daysUntilDelivery = dayDifference(today, record.deliveryDate)
      if (daysUntilDelivery === 1 && !hasArrived && !keys.has(arrivalKey)) {
        const text = `🚚 Receiving Reminder — ${record.number}`
        const didSend = await deliver({
          record,
          type: 'DELIVERY_ALERT',
          channel,
          text,
          dedupeKey: arrivalKey,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: '🚚 Receiving Reminder', emoji: true } },
            { type: 'section', text: { type: 'mrkdwn', text: `*${record.number}* is expected to arrive *tomorrow* (${displayDate(record.deliveryDate)})\nWarehouse: *${record.warehouse || 'Not set'}*\n\n📸 *Please upload arrival photos* (seal, opened, empty, signed BOL) after receiving.` } },
            ...receivingActions(record),
          ],
        })
        if (didSend) sent += 1
      }
    }

    const arrived = record.actualDeliveryDate || record.deliveredAt
    if (arrived && record.putawayDeadline && !record.putawayCompletedAt) {
      const putawayKey = `putaway-reminder:${record.number}:${today}`
      if (!keys.has(putawayKey)) {
        const remaining = businessDayDifference(today, record.putawayDeadline)
        const elapsed = Math.max(0, dayDifference(arrived, today))
        const percent = record.quantity > 0 ? Math.min(100, Math.round((record.received / record.quantity) * 100)) : 0
        const remainingLabel = remaining < 0 ? `${Math.abs(remaining)} day(s) late` : `${remaining} day(s) remaining`
        const heading = remaining < 0 ? `🚨 Putaway OVERDUE — ${remainingLabel}` : `🕒 Putaway Reminder — ${remainingLabel}`
        const text = `${heading} — ${record.number}`
        const didSend = await deliver({
          record,
          type: 'PUTAWAY_REMINDER',
          channel,
          text,
          dedupeKey: putawayKey,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: heading, emoji: true } },
            { type: 'section', text: { type: 'mrkdwn', text: `*${record.number}*${record.sellercloudIds.length ? ` (SC ${record.sellercloudIds.map((id) => `#${id}`).join(', ')})` : ''}\n${remaining < 0 ? 'Deadline was' : 'Deadline'}: *${displayDate(record.putawayDeadline)}*\nWarehouse: *${record.warehouse || 'Not set'}*\n${record.carrier || record.loadType ? `Carrier: ${record.carrier || 'Not set'}  |  Load Type: ${record.loadType || 'Not set'}  |  Delivered: ${displayDate(arrived)}\n` : ''}Arrived: *${elapsed} day(s) ago*\nReceived: *${record.received.toLocaleString('en-US')}/${record.quantity.toLocaleString('en-US')} units (${percent}%)*\n\n📸 Arrival photos still needed (seal, opened, empty, signed_bol) — please upload.` } },
            ...putawayActions(record),
          ],
        })
        if (didSend) sent += 1
      }
    }
  }
  return sent
}

async function processSummary(records: ContainerNotificationRecord[], today: string) {
  const channel = process.env.SLACK_CHANNEL_CONTAINER_TRACKER?.trim()
  if (!channel) throw new Error('SLACK_CHANNEL_CONTAINER_TRACKER is not configured.')
  const dedupeKey = `daily-summary:${today}`
  const keys = await existingKeys(['CUSTOM'])
  if (keys.has(dedupeKey)) return 0

  const active = records.filter((record) => !['CLOSED', 'PUTAWAY COMPLETE'].includes(record.status))
  const inTransit = active.filter((record) => ['BOOKED', 'LOADED', 'SAILING'].includes(record.status))
  const atPort = active.filter((record) => ['ARRIVED', 'DISCHARGED', 'NOT RELEASED', 'GATE OUT'].includes(record.status) && !record.deliveredAt)
  const awaitingPutaway = active.filter((record) => Boolean(record.deliveredAt || record.actualDeliveryDate) && !record.putawayCompletedAt)
  const arriving = active
    .filter((record) => record.eta && dayDifference(today, record.eta) >= 0 && dayDifference(today, record.eta) <= 7)
    .sort((a, b) => a.eta.localeCompare(b.eta))
  const warehouseCounts = [...new Map(active.map((record) => [record.warehouse, 0])).keys()]
    .filter(Boolean)
    .map((warehouse) => `${warehouse}: ${active.filter((record) => record.warehouse === warehouse).length}`)
    .join('  |  ')

  const lines = (items: ContainerNotificationRecord[], includeUnits = false) => items.length
    ? items.map((record) => `• *${record.number}* → ${record.warehouse || 'Unassigned'}${record.eta ? ` | ETA: ${displayDate(record.eta)}` : ''}${includeUnits ? ` | ${record.quantity.toLocaleString('en-US')} units` : ''}`).join('\n')
    : '_None_'
  const putawayLines = awaitingPutaway.length
    ? awaitingPutaway.map((record) => {
      const percent = record.quantity > 0 ? Math.min(100, Math.round((record.received / record.quantity) * 100)) : 0
      const photoUrl = appUrl(`/containers?container=${encodeURIComponent(record.number)}&detailTab=documentation#warehouse-arrival-photos`)
      return `• *${record.number}*${record.sellercloudIds.length ? ` (SC ${record.sellercloudIds.map((id) => `#${id}`).join(', ')})` : ''} → ${record.warehouse} | ${record.received}/${record.quantity} received (${percent}%)${record.putawayDeadline ? ` | Due: ${displayDate(record.putawayDeadline)}` : ''}${photoUrl ? ` | <${photoUrl}|📸 Add Photos>` : ''}`
    }).join('\n')
    : '_None_'

  const text = `📦 Daily Container Summary — ${displayDate(today)}`
  const didSend = await deliver({
    type: 'CUSTOM',
    channel,
    text,
    dedupeKey,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text, emoji: true } },
      { type: 'section', text: { type: 'mrkdwn', text: `🚢 *${inTransit.length} in transit*  |  ⚓ *${atPort.length} at port*  |  📬 *${awaitingPutaway.length} awaiting putaway*\n🏭 ${warehouseCounts || 'No active warehouse assignments'}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `📅 *Arriving This Week (${arriving.length})*\n${lines(arriving)}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `🚢 *In Transit (${inTransit.length})*\n${lines(inTransit, true)}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `⚓ *At Port (${atPort.length})*\n${lines(atPort)}` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `📬 *Awaiting Putaway (${awaitingPutaway.length})*\n${putawayLines}` } },
    ],
  })
  return didSend ? 1 : 0
}

export async function runSlackNotificationJob(job: Job, options?: { dryRun?: boolean }) {
  const today = todayInNewYork()
  const records = await loadContainerRecords()
  if (options?.dryRun) {
    return {
      job,
      today,
      records: records.length,
      scheduledDeliveries: records.filter((record) => Boolean(record.deliveryDate)).length,
      arrivalsToday: records.filter((record) => record.deliveryDate === today && !record.actualDeliveryDate && !record.deliveredAt).length,
      awaitingPutaway: records.filter((record) => Boolean(record.actualDeliveryDate || record.deliveredAt) && !record.putawayCompletedAt).length,
    }
  }
  const sent = job === 'summary'
    ? await processSummary(records, today)
    : await processReminders(records, today)
  return { job, today, records: records.length, sent }
}

export function addBusinessDays(date: Date, days: number) {
  const result = new Date(date)
  let remaining = days
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const weekday = result.getUTCDay()
    if (weekday !== 0 && weekday !== 6) remaining -= 1
  }
  return result
}
