'use client'

import { useState } from 'react'
import { authenticatedFetch } from '@/lib/auth/client-fetch'

export default function EmailIntegrationCard({ configured, address }: { configured: boolean; address: string }) {
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  async function testEmail() {
    setTesting(true)
    setFeedback(null)
    try {
      const response = await authenticatedFetch('/api/admin/email-test', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to send the SMTP test.')
      setFeedback({ type: 'success', message: data.message })
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Unable to send the SMTP test.' })
    } finally {
      setTesting(false)
    }
  }

  return <section className="integration-status-card">
    <div>
      <p className="eyebrow">EMAIL DELIVERY</p>
      <h2>SMTP integration</h2>
      <p>{configured ? `Configured to send from ${address}.` : 'One or more required SMTP environment variables are missing.'}</p>
    </div>
    <button type="button" onClick={() => void testEmail()} disabled={!configured || testing}>{testing ? 'Sending…' : 'Send test email'}</button>
    {feedback && <p className={`integration-feedback ${feedback.type}`} role="status">{feedback.message}</p>}
  </section>
}
