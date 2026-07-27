import 'server-only'

function configuredWebhook() {
  const value = process.env.SLACK_WEBHOOK_URL?.trim()
  if (!value) return null
  if (!value.startsWith('https://hooks.slack.com/')) throw new Error('SLACK_WEBHOOK_URL is not a valid Slack webhook.')
  return value
}

function configuredBotToken() {
  const value = process.env.SLACK_BOT_TOKEN?.trim()
  if (!value) return null
  if (!value.startsWith('xoxb-')) throw new Error('SLACK_BOT_TOKEN is not a valid Slack bot token.')
  return value
}

export function slackChannelForWarehouse(warehouse: string) {
  const normalized = warehouse.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  if (normalized.includes('JAX') && normalized.includes('WH4')) return process.env.SLACK_CHANNEL_JAX_WH4?.trim() || null
  if (normalized.includes('PA') && normalized.includes('WH9')) return process.env.SLACK_CHANNEL_PA_WH9?.trim() || null
  if (normalized.includes('TX') && normalized.includes('WH5')) return process.env.SLACK_CHANNEL_TX_WH5?.trim() || null
  return process.env.SLACK_CHANNEL_CONTAINER_TRACKER?.trim() || null
}

export async function sendSlackMessage(payload: Record<string, unknown>, channel: string | null) {
  const botToken = configuredBotToken()
  if (botToken && channel) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${botToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ ...payload, channel }),
      cache: 'no-store',
    })
    const result = await response.json() as { ok?: boolean; error?: string }
    if (!response.ok || !result.ok) {
      throw new Error(`Slack rejected the bot message${result.error ? `: ${result.error}` : ` (${response.status})`}.`)
    }
    return { transport: 'bot' as const }
  }

  const webhook = configuredWebhook()
  if (!webhook) throw new Error('Slack has no bot channel mapping or fallback webhook configured.')
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  if (!response.ok) {
    const details = (await response.text()).trim()
    throw new Error(`Slack rejected the message (${response.status})${details ? `: ${details}` : '.'}`)
  }
  return { transport: 'webhook' as const }
}
