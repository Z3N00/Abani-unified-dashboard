import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import type { PermissionSet } from '@/lib/access-control'
import { createAdminClient } from '@/lib/supabase/admin'

export type StaffDirectoryUser = {
  id: string
  name: string | null
  email: string
  role: string
  permissions: PermissionSet
}

let directoryCache: { expiresAt: number; value: StaffDirectoryUser[] } | null = null

async function loadStaffDirectory(): Promise<StaffDirectoryUser[]> {
  const db = createAdminClient()
  const [usersResult, permissionsResult] = await Promise.all([
    db.from('User').select('id,name,email,role').order('createdAt', { ascending: false }).limit(100),
    db.from('UserPermission').select('userId,permissions'),
  ])

  if (usersResult.error) throw usersResult.error
  if (permissionsResult.error) throw permissionsResult.error

  const permissionByUser = new Map(
    (permissionsResult.data ?? []).map((row: { userId: string; permissions: PermissionSet }) => [
      row.userId,
      row.permissions,
    ]),
  )

  return (usersResult.data ?? []).map((user) => ({
    ...user,
    permissions: permissionByUser.get(user.id) ?? {},
  }))
}

const getCachedStaffDirectory = unstable_cache(loadStaffDirectory, ['staff-directory-v1'], {
  revalidate: 300,
  tags: ['staff-directory'],
})

export async function getStaffDirectory(): Promise<StaffDirectoryUser[]> {
  if (directoryCache && directoryCache.expiresAt > Date.now()) return directoryCache.value
  const value = await getCachedStaffDirectory()
  directoryCache = { value, expiresAt: Date.now() + 300_000 }
  return value
}

export function clearStaffDirectoryCache() {
  directoryCache = null
  revalidateTag('staff-directory', 'max')
}
