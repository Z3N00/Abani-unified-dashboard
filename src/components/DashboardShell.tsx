'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { SessionUser } from '@/lib/auth/session'

type IconName = 'overview' | 'containers' | 'purchasing' | 'inventory' | 'users' | 'email' | 'warehouse' | 'bell' | 'settings' | 'shield' | 'collapse' | 'expand'

const icons: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  containers: <><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="m3 12 9 4 9-4" /><path d="m3 17 9 4 9-4" /></>,
  purchasing: <><path d="M3 3h3l2.3 11.2a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 2-1.6L21 8H7" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
  inventory: <><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" /><path d="m4.5 6.5 7.5 4 7.5-4" /><path d="M12 10.5V20" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 21v-1.4a4.6 4.6 0 0 1 4.6-4.6h1.8a4.6 4.6 0 0 1 4.6 4.6V21" /><path d="M16 5.5a3 3 0 0 1 0 5.7" /><path d="M18 15a4.4 4.4 0 0 1 3 4.2V21" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  warehouse: <><path d="M3 21V8l9-5 9 5v13" /><path d="M7 21v-8h10v8" /><path d="M9 16h6M9 19h6" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  collapse: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M10 4v16" /><path d="m15 9-3 3 3 3" /></>,
  expand: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M14 4v16" /><path d="m9 9 3 3-3 3" /></>,
}

function NavIcon({ name }: { name: IconName }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

const links: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/containers', label: 'Containers', icon: 'containers' },
]

export default function DashboardShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const name = user.name || user.email.split('@')[0]
  const adminPages: Record<string, string> = { '/users': 'Users & permissions', '/email-queue': 'Email Queue', '/warehouses': 'Warehouses', '/notifications': 'Notifications', '/settings': 'Settings', '/security-log': 'Security Log' }
  const currentPage = adminPages[path] ?? links.find((link) => link.href === path)?.label ?? 'Workspace'

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current
      return next
    })
  }

  return (
    <div className={`ops-shell${collapsed ? ' rail-collapsed' : ''}`}>
      <aside className="ops-rail">
        <div className="ops-brand">
          <Image className="brand-mark-image" src="/abani-mark.svg" alt="Abani" width={34} height={44} priority />
          <div className="brand-words"><Image src="/abani-name.svg" alt="Abani Rugs" width={148} height={38} priority /></div>
          <button className="rail-toggle" type="button" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><NavIcon name={collapsed ? 'expand' : 'collapse'} /></button>
        </div>
        <p className="rail-label">WORKSPACE</p>
        <nav className="ops-nav">
          {links.map(({ href, label, icon }) => <Link key={href} href={href} title={collapsed ? label : undefined} className={path === href ? 'ops-nav-active' : ''}><NavIcon name={icon} /><span className="nav-label">{label}</span></Link>)}
          {user.role === 'ADMIN' && <>
            <p className="rail-label rail-label-admin">ADMIN</p>
            <Link href="/email-queue" title={collapsed ? 'Email Queue' : undefined} className={path === '/email-queue' ? 'ops-nav-active' : ''}><NavIcon name="email" /><span className="nav-label">Email Queue</span></Link>
            <Link href="/users" title={collapsed ? 'Users & permissions' : undefined} className={path === '/users' ? 'ops-nav-active' : ''}><NavIcon name="users" /><span className="nav-label">Users & permissions</span></Link>
            <Link href="/warehouses" title={collapsed ? 'Warehouses' : undefined} className={path === '/warehouses' ? 'ops-nav-active' : ''}><NavIcon name="warehouse" /><span className="nav-label">Warehouses</span></Link>
            <Link href="/notifications" title={collapsed ? 'Notifications' : undefined} className={path === '/notifications' ? 'ops-nav-active' : ''}><NavIcon name="bell" /><span className="nav-label">Notifications</span></Link>
            <Link href="/settings" title={collapsed ? 'Settings' : undefined} className={path === '/settings' ? 'ops-nav-active' : ''}><NavIcon name="settings" /><span className="nav-label">Settings</span></Link>
            <Link href="/security-log" title={collapsed ? 'Security Log' : undefined} className={path === '/security-log' ? 'ops-nav-active' : ''}><NavIcon name="shield" /><span className="nav-label">Security Log</span></Link>
          </>}
        </nav>
        <div className="future-nav" aria-label="Future dashboard modules">
          <p className="rail-label">COMING NEXT</p>
          <div><NavIcon name="purchasing" /><span>Purchasing</span></div>
          <div><NavIcon name="inventory" /><span>Inventory</span></div>
        </div>
      </aside>
      <section className="ops-main">
        <div className="global-topbar">
          <div className="topbar-context"><span>{currentPage}</span><small>Abani Rugs operations workspace</small></div>
          <div className="topbar-account"><span>{name}</span><span className="role-pill">{user.role.replaceAll('_', ' ')}</span><form action="/api/auth/logout" method="post"><button className="signout-action"><span>{name[0]?.toUpperCase()}</span>Sign out</button></form></div>
        </div>
        {children}
      </section>
    </div>
  )
}
