import DashboardShell from '@/components/DashboardShell'
import { requireUser } from '@/lib/auth/current-user'

export default async function Home() {
  const user = await requireUser()
  const name = user.name || user.email.split('@')[0]

  return (
    <DashboardShell user={user}>
      <main className="ops-body">
        <section className="page-intro">
          <p className="eyebrow">OPERATIONS DESK</p>
          <h1>Good morning, {name}.</h1>
        </section>
        <section className="hero-panel">
          <div>
            <p className="eyebrow">UNIFIED OPERATIONS</p>
            <h2>One workspace for every handoff.</h2>
            <p>We&apos;re connecting your existing production data module by module, beginning with the Containers workflow.</p>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}
