import 'server-only'

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export const getAdminWarehouses = unstable_cache(async () => {
  const { data, error } = await createAdminClient()
    .from('Warehouse')
    .select('id,name,sellercloudId,slackChannelName,address,timezone,regionStates,updatedAt')
    .order('name')
  if (error) throw error
  return data ?? []
}, ['admin-warehouses'], { revalidate: 300, tags: ['admin-warehouses'] })

export const getAdminNotifications = unstable_cache(async () => {
  const { data, error } = await createAdminClient()
    .from('NotificationLog')
    .select('id,type,channel,message,sentAt,success,errorMessage')
    .order('sentAt', { ascending: false })
    .limit(150)
  if (error) throw error
  return data ?? []
}, ['admin-notifications'], { revalidate: 30, tags: ['admin-notifications'] })

export const getAdminSecurityLog = unstable_cache(async () => {
  const db = createAdminClient()
  const [logs, users] = await Promise.all([
    db.from('SecurityLog').select('id,event,userId,ip,userAgent,details,createdAt').order('createdAt', { ascending: false }).limit(200),
    db.from('User').select('id,name,email').limit(500),
  ])
  if (logs.error) throw logs.error
  if (users.error) throw users.error
  return { logs: logs.data ?? [], users: users.data ?? [] }
}, ['admin-security-log'], { revalidate: 30, tags: ['admin-security-log'] })

export const getAdminSettings = unstable_cache(async () => {
  const { data, error } = await createAdminClient()
    .from('AppSetting')
    .select('key,value,updatedAt')
    .order('key')
  if (error) throw error
  return data ?? []
}, ['admin-settings'], { revalidate: 300, tags: ['admin-settings'] })
