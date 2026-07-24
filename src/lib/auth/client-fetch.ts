'use client'

/**
 * Fetches a protected dashboard endpoint and converts an expired session into
 * a clear login redirect instead of leaving an "Unauthorized" API error in UI.
 */
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  if (response.status === 401) {
    window.location.replace('/login?reason=session-expired')
    throw new Error('Your session expired. Redirecting to sign in…')
  }
  return response
}
