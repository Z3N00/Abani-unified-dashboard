'use client'

import { FormEvent, Suspense, useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const displayedError = error || (searchParams.get('reason') === 'session-expired' ? 'Your session expired. Please sign in again.' : '')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error ?? 'Unable to sign in.')
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('Unable to reach the dashboard. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="login-brand"><Image src="/abani-wordmark.svg" alt="Abani" width={336} height={68} priority /></div>
        <div className="intro-copy">
          <p className="eyebrow">ABANI HOME · OPERATIONS</p>
          <p className="eyebrow login-rugs-label">ABANI RUGS / OPERATIONS</p>
          <h1>Everything in motion, in one clear view.</h1>
          <p>Manage purchase orders, containers, documents, and warehouse operations with the context your team needs.</p>
        </div>
        <div className="intro-footer"><span className="intro-rule" />Private workspace · Secure staff access</div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-heading"><p className="eyebrow">WELCOME BACK</p><h2>Sign in to Abani Rugs</h2><p>Use your staff account to continue.</p></div>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@abanirugs.com" required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /></label>
          {displayedError && <p className="login-error" role="alert">{displayedError}</p>}
          <button className="login-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} <span>→</span></button>
          <p className="login-help">Need access? Contact an administrator to create your staff account.</p>
        </form>
      </section>
    </main>
  )
}
