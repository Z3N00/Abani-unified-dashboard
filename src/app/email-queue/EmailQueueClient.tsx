'use client'

import { useCallback, useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/auth/client-fetch'

type QueueStatus = 'queued' | 'sent' | 'discarded'
type QueueEmail = {
  id: string
  to: string
  toName: string | null
  subject: string
  type: string
  status: QueueStatus
  queuedAt: string | null
  sentAt: string | null
  discardedAt: string | null
}

const labels: Record<string, string> = {
  overseas_doc_created: 'Doc Entry Created',
  overseas_doc_reminder: 'Documentation Reminder',
}

function relativeDate(value: string | null) {
  if (!value) return '—'
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

export default function EmailQueueClient() {
  const [status, setStatus] = useState<QueueStatus>('queued')
  const [emails, setEmails] = useState<QueueEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/admin/email-queue?status=${status}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load the email queue.')
      setEmails(data.emails ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the email queue.')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(task)
  }, [load])

  async function act(id: string, action: 'send' | 'discard') {
    setWorkingId(id)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/admin/email-queue/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Unable to ${action} this email.`)
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} this email.`)
    } finally {
      setWorkingId('')
    }
  }

  async function sendAll() {
    for (const email of emails) {
      if (email.status !== 'queued') continue
      await act(email.id, 'send')
    }
  }

  return <>
    <header className="admin-operations-heading">
      <div><p className="eyebrow">ADMINISTRATION</p><h1>Email Queue</h1><p>{status === 'queued' ? `${emails.length} email${emails.length === 1 ? '' : 's'} ready to send` : `${emails.length} ${status} email${emails.length === 1 ? '' : 's'}`}</p></div>
      <div className="email-queue-controls">
        {status === 'queued' && emails.length > 0 && <button className="queue-send-all" type="button" onClick={() => void sendAll()} disabled={Boolean(workingId)}>Send All ({emails.length})</button>}
        <nav>{(['queued', 'sent', 'discarded'] as QueueStatus[]).map((item) => <button className={status === item ? 'active' : ''} onClick={() => setStatus(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      </div>
    </header>
    {error && <p className="admin-operation-error">{error}</p>}
    <section className="email-queue-list">
      {loading ? <div className="admin-operation-empty">Loading email queue…</div> : emails.length === 0 ? <div className="admin-operation-empty">No {status} emails.</div> : emails.map((email) => <article key={email.id}>
        <span className="queue-type">{labels[email.type] ?? email.type.replaceAll('_', ' ')}</span>
        <div><strong>{email.subject}</strong><small>To: {email.toName ? `${email.toName} ` : ''}&lt;{email.to}&gt;</small></div>
        <time>{relativeDate(email.queuedAt)}</time>
        {status === 'queued' && <div className="queue-actions"><button className="send" disabled={workingId === email.id} onClick={() => void act(email.id, 'send')}>Send</button><button className="discard" disabled={workingId === email.id} onClick={() => void act(email.id, 'discard')}>Discard</button></div>}
      </article>)}
    </section>
  </>
}
