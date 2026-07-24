import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

// Database types will be generated from the production schema before module work begins.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: ReturnType<typeof createClient<any>> | undefined

/** Server-only database client. Never import this module into client components. */
export function createAdminClient() {
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = createClient<any>(serverEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}
