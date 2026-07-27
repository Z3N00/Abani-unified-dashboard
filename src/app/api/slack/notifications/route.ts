import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { hasAccess } from '@/lib/access-control'
import { runSlackNotificationJob } from '@/lib/slack/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isScheduledRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

function hourInNewYork() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date()))
}

async function authorize(request: NextRequest) {
  if (isScheduledRequest(request)) return true
  const user = await getApiUser()
  return Boolean(user?.role === 'ADMIN' || (user && hasAccess(user, 'containers.slack', 'admin')))
}

async function execute(request: NextRequest) {
  if (!await authorize(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const job = request.nextUrl.searchParams.get('job') === 'summary' ? 'summary' : 'reminders'
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'
  if (isScheduledRequest(request) && !dryRun) {
    const expectedHour = job === 'summary' ? 7 : 6
    const localHour = hourInNewYork()
    if (localHour !== expectedHour) {
      return NextResponse.json({ job, skipped: true, reason: `Current New York hour is ${localHour}; expected ${expectedHour}.` })
    }
  }
  try {
    return NextResponse.json(await runSlackNotificationJob(job, { dryRun }))
  } catch (error) {
    console.error('Slack notification job failed', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Notification job failed.' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return execute(request)
}

export async function POST(request: NextRequest) {
  return execute(request)
}
