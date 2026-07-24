# Vercel deployment

## Recommended ownership

Deploy the production dashboard to an Abani-owned Vercel team and private Git
repository. Add at least one other company administrator so the application is
not tied to a single employee's personal account.

## Before importing the repository

1. Confirm `.env` is not committed.
2. Commit and push the reviewed application source to the private repository.
3. Generate separate strong values for `APP_SESSION_SECRET` and `CRON_SECRET`.
4. Keep all server-only credentials out of screenshots, chat, tickets, and Git.

PowerShell can generate a secret without using a website:

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
)
```

Run it twice and use a different result for each secret.

## Import into Vercel

1. In the Abani Vercel team, choose **Add New → Project**.
2. Import the private Git repository.
3. Select **Next.js** if it is not detected automatically.
4. If the repository contains multiple projects, set the root directory to
   `abani-unified-dashboard`.
5. Add every variable listed in `.env.example` under
   **Project Settings → Environment Variables**.
6. Add the variables to **Production**. Add them to **Preview** only when
   preview deployments are allowed to access the same company systems.
7. Mark server-only credentials as sensitive where Vercel offers that option.
8. Deploy.

Do not use a Supabase publishable/anon key in
`SUPABASE_SERVICE_ROLE_KEY`. The service-role value must remain server-only.

## Scheduled inventory sync

`vercel.json` schedules `/api/sync/inventory` daily at `10:00 UTC`. Vercel sends
the configured `CRON_SECRET` as a Bearer authorization header. The same
`CRON_SECRET` must be present in the Production environment.

## Production smoke test

After the first deployment:

1. Open `/login` in a private browser window.
2. Confirm a real staff account can sign in and sign out.
3. Confirm `/containers` loads active and archived data.
4. Open a container and check overview, items, trucking, timeline/map, and
   documentation.
5. Confirm documentation photos load.
6. Confirm Payments and Documentation list tabs load.
7. Confirm only an administrator can access `/users`.
8. Test inventory sync once as an administrator and inspect the deployment
   logs.
9. Confirm the scheduled job appears under the project's Cron Jobs settings.

Do not create test users or change real-user permissions against the production
Supabase project unless the change is intended for production.
