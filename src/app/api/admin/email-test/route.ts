import { NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth/api-user'
import { sendQueuedEmail } from '@/lib/email/smtp'

export async function POST() {
  const user = await getApiUser()
  if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await sendQueuedEmail({
      to: user.email,
      subject: 'Abani Rugs Operations — SMTP test',
      html: [
        `<p>Hello ${user.name || user.email},</p>`,
        '<p>The Abani Rugs Operations email integration is connected and able to deliver documentation invitations.</p>',
        '<p>This was a test message initiated from the protected Admin Settings page.</p>',
      ].join(''),
    })
    return NextResponse.json({ message: `Test email sent to ${user.email}.` })
  } catch (error) {
    console.error('SMTP test failed', error)
    const message = error instanceof Error && error.message.includes('is not configured')
      ? 'SMTP is not completely configured on this deployment.'
      : 'SMTP rejected the test message. Check the Vercel SMTP values and Gmail app password.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
