import { NextResponse } from 'next/server'
import { hasAccess } from '@/lib/access-control'
import { getApiUser } from '@/lib/auth/api-user'
import { getContainerDetail } from '@/lib/containers/data'
import { sendSlackMessage, slackChannelForWarehouse } from '@/lib/slack/send'

const showDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
  : 'N/A'

export async function POST(request: Request) {
  const user = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!hasAccess(user, 'containers.slack')) return NextResponse.json({ error: 'You do not have permission to send container updates to Slack.' }, { status: 403 })

  try {
    const body = await request.json()
    const containerNumber = String(body.containerNumber ?? '').trim().toUpperCase()
    if (!containerNumber) return NextResponse.json({ error: 'Container number is required.' }, { status: 400 })
    const container = await getContainerDetail(containerNumber)
    if (!container) return NextResponse.json({ error: 'Container was not found.' }, { status: 404 })

    const receivedPercent = container.quantity > 0
      ? Math.min(100, Math.round((container.receivedQuantity / container.quantity) * 100))
      : 0
    const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '')
    const dashboardUrl = baseUrl ? `${baseUrl}/containers` : ''

    const channel = slackChannelForWarehouse(container.warehouse)
    const delivery = await sendSlackMessage({
      text: `Container update: ${container.number} — ${container.status}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `Container ${container.number}`, emoji: true } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Status*\n${container.status || 'N/A'}` },
            { type: 'mrkdwn', text: `*Warehouse*\n${container.warehouse || 'N/A'}` },
            { type: 'mrkdwn', text: `*Carrier*\n${container.carrier || 'N/A'}` },
            { type: 'mrkdwn', text: `*Vessel*\n${container.vessel || 'N/A'}` },
            { type: 'mrkdwn', text: `*ETA port*\n${showDate(container.etaPort)}` },
            { type: 'mrkdwn', text: `*Destination*\n${container.port || 'N/A'}` },
            { type: 'mrkdwn', text: `*Quantity*\n${container.quantity.toLocaleString('en-US')}` },
            { type: 'mrkdwn', text: `*Receiving*\n${container.receivedQuantity.toLocaleString('en-US')} (${receivedPercent}%)` },
          ],
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `Sent by *${user.name || user.email}* from Abani Rugs Operations` }] },
        ...(dashboardUrl ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Containers' }, url: dashboardUrl }] }] : []),
      ],
    }, channel)

    const destination = delivery.transport === 'bot' && channel ? `${container.warehouse} channel` : 'default channel'
    return NextResponse.json({ message: `Container ${container.number} was sent to the ${destination}.` })
  } catch (error) {
    console.error('Slack container send failed', error)
    const message = error instanceof Error && error.message.includes('configured')
      ? 'Slack is not configured on this deployment.'
      : error instanceof Error ? error.message : 'Unable to send this container to Slack.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
