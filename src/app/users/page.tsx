import { hash } from 'bcryptjs'
import { randomUUID } from 'crypto'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { APP_ROLES, type AppRole } from '@/lib/access-control'
import { requireAdmin } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { clearStaffDirectoryCache, getStaffDirectory } from '@/lib/users/data'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const admin = await requireAdmin()
  const users = await getStaffDirectory()

  return (
    <DashboardShell user={admin}>
      <main className="admin-page">
        <header><p className="eyebrow">ADMINISTRATION</p><h1>Users & permissions</h1><p>Create staff accounts and set access as the new workspace grows.</p></header>
        <section className="admin-grid"><CreateUserForm /><section className="user-list"><div className="list-heading"><h2>Staff directory</h2><span>{users.length} accounts</span></div>{users.map((user) => <article key={user.id}><div className="user-avatar">{(user.name || user.email).charAt(0).toUpperCase()}</div><div><strong>{user.name || 'Unnamed user'}</strong><small>{user.email}</small></div><span className="admin-role">{user.role.replaceAll('_', ' ')}</span></article>)}</section></section>
        <UsersClient users={users} />
      </main>
    </DashboardShell>
  )
}

function CreateUserForm() {
  return <form className="create-user" action={createUser} autoComplete="off"><h2>Create staff account</h2><input name="newUserFullName" placeholder="Full name" autoComplete="off" required /><input name="newUserEmail" type="email" placeholder="Email address" autoComplete="off" required /><input name="newUserPassword" type="password" placeholder="Temporary password (8+ characters)" autoComplete="new-password" minLength={8} required /><select name="role" defaultValue="STAFF">{APP_ROLES.map((role) => <option value={role} key={role}>{role.replaceAll('_', ' ')}</option>)}</select><button type="submit">Create account →</button><small>New accounts begin with no granular permissions. Assign them below.</small></form>
}

async function createUser(formData: FormData) {
  'use server'
  await requireAdmin()
  const name = String(formData.get('newUserFullName') ?? '').trim()
  const email = String(formData.get('newUserEmail') ?? '').trim()
  const password = String(formData.get('newUserPassword') ?? '')
  const role = String(formData.get('role') ?? 'STAFF') as AppRole
  if (!name || !email || password.length < 8 || !APP_ROLES.includes(role)) redirect('/users')
  const db = createAdminClient()
  const id = randomUUID()
  const { error } = await db.from('User').insert({ id, name, email, password: await hash(password, 12), role, permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  if (!error) await db.from('UserPermission').insert({ id: randomUUID(), userId: id, permissions: {}, preset: 'custom', updatedAt: new Date().toISOString() })
  if (!error) clearStaffDirectoryCache()
  redirect('/users')
}
