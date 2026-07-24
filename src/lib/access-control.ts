export const APP_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER', 'PURCHASE_ORDER_MANAGER', 'OVERSEAS_REP', 'WAREHOUSE_GENERAL', 'STAFF'] as const
export type AppRole = (typeof APP_ROLES)[number]

export const PERMISSION_LEVELS = ['none', 'read', 'write', 'admin'] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]
export type PermissionSet = Record<string, PermissionLevel>

export type PermissionModule = { key: string; label: string; description: string; sections?: { key: string; label: string }[] }

/** Single source of truth for the admin editor, navigation visibility, and API checks. */
export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'overview', label: 'Overview', description: 'Main dashboard only' },
  { key: 'purchase_orders', label: 'Purchase Orders', description: 'Sellercloud-synced orders' },
  { key: 'containers', label: 'Containers', description: 'Shipping and receiving operations', sections: [
    { key: 'tracking', label: 'Tracking overview' }, { key: 'items', label: 'Container items' },
    { key: 'trucking', label: 'Trucking' }, { key: 'timeline', label: 'Timeline & map' },
    { key: 'documentation', label: 'Documentation' }, { key: 'documentation_upload', label: 'Upload documents & photos' },
    { key: 'payments', label: 'Container payments' }, { key: 'slack', label: 'Send Slack' },
    { key: 'pdf', label: 'Export PDF' }, { key: 'sync', label: 'Sellercloud / ShipsGo sync' },
  ] },
  { key: 'po_manager', label: 'PO Manager', description: 'Internal purchase-order planning' },
  { key: 'inventory', label: 'Inventory', description: 'Warehouse inventory visibility' },
  { key: 'finance', label: 'Finance', description: 'Finance and payment operations' },
  { key: 'users', label: 'Users & Permissions', description: 'Staff access administration' },
]

export function permissionLevel(permissions: PermissionSet | null | undefined, key: string): PermissionLevel {
  return permissions?.[key] ?? 'none'
}

export function can(permissions: PermissionSet | null | undefined, key: string, required: Exclude<PermissionLevel, 'none'> = 'read'): boolean {
  const rank: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 }
  return rank[permissionLevel(permissions, key)] >= rank[required]
}

type AccessSubject = { role: string; permissions: PermissionSet }

const levelRank: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 }

function roleLevel(role: string, key: string): PermissionLevel {
  if (role === 'ADMIN') return 'admin'
  if (role === 'WAREHOUSE_MANAGER') {
    if (key === 'containers' || key === 'containers.tracking' || key === 'containers.items' || key === 'containers.timeline') return 'read'
    if (key === 'containers.trucking') return 'write'
    if (key === 'containers.slack' || key === 'containers.pdf') return 'read'
  }
  if (role === 'WAREHOUSE_GENERAL') {
    if (key === 'containers' || key === 'containers.tracking' || key === 'containers.items') return 'read'
    if (key === 'containers.slack' || key === 'containers.pdf') return 'read'
  }
  if (role === 'OVERSEAS_REP' || role === 'OVERSEAS') {
    if (key === 'containers' || key === 'containers.tracking' || key === 'containers.items' || key === 'containers.timeline') return 'read'
  }
  return 'none'
}

/** Applies the intended role baseline plus an admin-managed per-user override. */
export function hasAccess(user: AccessSubject, key: string, required: Exclude<PermissionLevel, 'none'> = 'read'): boolean {
  const directLevel = permissionLevel(user.permissions, key)
  const moduleLevel = key.includes('.') ? permissionLevel(user.permissions, key.split('.')[0]) : 'none'
  const effective = Math.max(levelRank[roleLevel(user.role, key)], levelRank[directLevel], levelRank[moduleLevel])
  return effective >= levelRank[required]
}
