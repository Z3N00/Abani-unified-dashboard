'use client'

import { useState } from 'react'
import { PERMISSION_LEVELS, PERMISSION_MODULES, type PermissionLevel, type PermissionSet } from '@/lib/access-control'
import { authenticatedFetch } from '@/lib/auth/client-fetch'

type User = { id: string; name: string | null; email: string; role: string; permissions: PermissionSet }

export default function UsersClient({ users }: { users: User[] }) {
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '')
  const selected = users.find((user) => user.id === selectedId)
  const [draft, setDraft] = useState<PermissionSet>(selected?.permissions ?? {})
  const [saving, setSaving] = useState(false)
  const isAdmin = selected?.role === 'ADMIN'

  function choose(id: string) {
    const user = users.find((item) => item.id === id)
    setSelectedId(id)
    setDraft(user?.permissions ?? {})
  }

  function setPermission(key: string, value: PermissionLevel) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    await authenticatedFetch('/api/admin/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selected.id, permissions: draft }) })
    setSaving(false)
  }

  function level(key: string): PermissionLevel {
    return isAdmin ? 'admin' : draft[key] ?? 'none'
  }

  return (
    <div className="permission-workspace">
      <aside className="permission-list">
        <h2>Staff directory</h2>
        {users.map((user) => <button key={user.id} onClick={() => choose(user.id)} className={user.id === selectedId ? 'selected' : ''}><b>{(user.name || user.email).charAt(0)}</b><span>{user.name || user.email}<small>{user.role.replaceAll('_', ' ')}</small></span></button>)}
      </aside>
      <section className="permission-editor">
        {selected && <>
          <div className="editor-head">
            <div><p className="eyebrow">ACCESS CONTROL</p><h2>{selected.name || selected.email}</h2><p>{selected.email} · {isAdmin ? 'ADMIN · Full access by role' : selected.role.replaceAll('_', ' ')}</p></div>
            <button onClick={save} disabled={saving || isAdmin}>{isAdmin ? 'Admin has full access' : saving ? 'Saving…' : 'Save permissions'}</button>
          </div>
          {PERMISSION_MODULES.map((module) => <article className="permission-module" key={module.key}>
            <div className="module-line"><div><h3>{module.label}</h3><p>{module.description}</p></div><Levels value={level(module.key)} onChange={(value) => setPermission(module.key, value)} disabled={isAdmin} /></div>
            {module.sections?.map((section) => <div className="section-line" key={section.key}><span>{section.label}</span><Levels value={level(`${module.key}.${section.key}`)} onChange={(value) => setPermission(`${module.key}.${section.key}`, value)} compact disabled={isAdmin} /></div>)}
          </article>)}
        </>}
      </section>
    </div>
  )
}

function Levels({ value, onChange, compact = false, disabled = false }: { value: PermissionLevel; onChange: (value: PermissionLevel) => void; compact?: boolean; disabled?: boolean }) {
  return <div className={`level-buttons ${compact ? 'compact' : ''}`}>{PERMISSION_LEVELS.map((permissionLevel) => <button className={value === permissionLevel ? 'chosen' : ''} onClick={() => onChange(permissionLevel)} disabled={disabled} key={permissionLevel}>{permissionLevel}</button>)}</div>
}
