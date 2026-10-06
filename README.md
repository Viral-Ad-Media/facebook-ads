# Facebook Ads Studio

A Next.js console for researching competitors, preparing ad briefs, reviewing generated creatives,
queuing Meta campaigns and viewing performance. Claude Code processes the queue through connected
MCP tools. UI buttons queue jobs; they do not call Meta or media providers directly.

The audit fixes add server validation, transactional/idempotent enqueueing, versioned creative
approval, expiring sessions, engine leases/checkpoints, account budget reservations and objective-aware
optimization. See [AUDIT.md](AUDIT.md) for the findings, resolution map and validation limits.

## Stack and architecture

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Recharts 3 · postgres.js · Zod.
Hosted Postgres (normally Supabase) owns the isolated `fbads` schema. This app does not use SQLite.

| Component | Responsibility |
| --- | --- |
| `app/`, `components/` | Console, previews, approvals, authenticated API routes |
| `lib/validation.ts`, `lib/safety.ts` | Typed requests, approved assets, account allowance, request replay |
| `proxy.ts`, `lib/auth.ts` | Access checks, roles, random sessions, CSRF origin checks |
| `app/api/engine/route.ts` | Atomic claims, leases, preflight, checkpoints and action completion |
| `lib/rules.ts`, `scripts/evaluate-rules.ts` | Recent-window optimization proposals |
| `.claude/skills/` | Connector execution instructions for the separately invoked engine |
| `migrations/` | Schema, safety upgrade, app-role grants |

The app and engine must use the same database. The engine uses Supabase MCP SQL to store provider
results and metrics, but must claim jobs and complete operations through the authenticated gateway.
These trusted instructions do not replace Meta permissions or human ad-policy review.

## Setup

Use Node.js 22+ and npm. A committed lockfile supports reproducible installs.

```bash
git clone https://github.com/Viral-Ad-Media/facebook-ads.git
cd facebook-ads
npm ci
cp .env.example .env.local
# Configure database, access and engine settings as described below.
npm run migrate
npm run dev
```

Open [http://localhost:3100](http://localhost:3100). For production use `npm run build` followed by
`npm run start`. Both servers use port 3100. Normal installation downloads the ffmpeg-static binary;
`npm ci --ignore-scripts` is sufficient for the app and tests, but does not prepare ffmpeg for video work.

### Database provisioning

1. Set `MIGRATION_DATABASE_URL` to an administrator connection and run `npm run migrate`.
   The runner checks migration checksums and applies each file in a locked transaction.
2. Provision a strong password for the created `fbads_app` role through your database administrator
   tools (`\password fbads_app` in psql). Passwords are never embedded in migrations.
3. Set `DATABASE_URL` to the dedicated app role; its `search_path` must be `fbads`. The client verifies
   TLS and uses `prepare: false` for transaction poolers. Grant scripts revoke schema access from
   PUBLIC and Supabase anon/authenticated roles.
4. Use the same Supabase project for `SUPABASE_PROJECT_ID` on the engine machine.
5. In Settings, create an audience profile, set account/Page IDs and confirm USD/account timezone.

For an existing database, take a backup and apply migrations in staging first. The upgrade preserves
existing data and conservatively reserves existing paused/active/launching campaign budgets. It also
converts queue/action JSON columns to JSONB; invalid legacy JSON will stop the migration for review.
The schema of an existing hosted project has not been inspected here.

Core tables: `settings`, `icp_profiles`, `briefs`, `creatives`, `campaigns`, `ad_sets`, `ads`,
`metrics_daily`, `metrics_period`, `jobs`, `engine_actions`, `competitor_ads`, `learnings`.
Safety tables: `requests`, `sessions`, `login_attempts`, `account_sync`, `operations`.
Money uses integer cents. Defaults merge at settings read time; ICP records are created in Settings.

### Environment

| Variable | Where | Use |
| --- | --- | --- |
| `DATABASE_URL` | App and rules runner | Restricted role; required at first query |
| `MIGRATION_DATABASE_URL` | Administrator machine only | Migration runner |
| `DATABASE_SSL=disable` | Development/test only | Local Postgres without TLS; ignored in production |
| `SUPABASE_PROJECT_ID` | Engine | Project hosting `fbads` |
| `ADMIN_PASSWORD` | App | Bootstrap `admin` account; minimum 16 characters in production |
| `ADMIN_USERS_JSON` | App | Optional named accounts with `password` and `operator`/`viewer` role; overrides bootstrap password |
| `ENGINE_TOKEN` | App and engine | Same secret, at least 32 random characters |
| `ENGINE_BASE_URL` | Engine | App URL; HTTPS required outside localhost |
| `STORAGE_URL`, `STORAGE_BUCKET`, `STORAGE_SERVICE_KEY` | Engine only | Supabase public asset bucket and upload credentials |

Store secrets in environment management, not Git or `NEXT_PUBLIC_*`. Do not put the administrator
connection or storage service key on the web deployment. Set app variables in Vercel; `vercel.json`
pins functions to `cle1`. Choose database region/pool capacity appropriate to deployment instance count.

## Workflow

| Page | Use | Engine command |
| --- | --- | --- |
| Campaigns `/` | Paginated campaigns, recent spend/CTR and queued status changes | `/launch`, `/monitor` |
| Competitors `/competitors` | Scan, star/delete observations, inspire a brief | `/competitor-scan` |
| Ad Studio `/studio` | Briefs, variants, Save/Discard copy edits, versioned approval | `/process-jobs` |
| Launch `/launch` | Approved creatives, audience, objective and reserved daily budget | `/launch` |
| Learnings `/learnings` | Stored performance and research insights | `/monitor` |
| Settings `/settings` | Account IDs, audiences and validated guardrails | Read by engine |

First-run onboarding can be replayed from navigation. Long-running competitor ads are research
signals, not verified profitable ads. The local Feed/Story mockups are illustrative; use actual Meta
previews during launch. Formats: 1080×1080, 1080×1350, 1080×1920 and 1200×628.
Application copy limits are enforced at 125/40/30 characters for primary text/headline/description.

Create a brief → run generation → save/review → approve → queue launch → run `/launch`.
New Meta entities must be created **PAUSED**. Activation is a separate dashboard request processed
by `/launch`; the API rejects `activate_immediately`. Activation requires a fresh full-account sync.
Copy/media changes increment the creative version and invalidate approval. Legacy creatives need
reapproval after migration. Already launched creatives cannot be edited through the console.

Dashboard figures cover recent stored data; they are not real-time Meta insights. Failed requests
show an error and preserve data/input. Polling pauses in hidden tabs and backs off after failures.
The studio/launch queries are bounded to 100 records; campaigns and competitor results use 20 per page.

## Engine protocol

The four `.claude/skills/*/SKILL.md` files describe connector work. Read the relevant skill and
use `npm run engine -- '<JSON>'` to call the gateway with an engine worker UUID.

1. `claim`: atomically claim one job with a ten-minute lease; `heartbeat` renews it.
2. `job_operation`: preflight each paid generation or Meta mutation using a deterministic step key.
3. Make the intended provider call within the returned 60-second permit. `already_done` means reuse
   the saved provider result, not repeat the call.
4. `finish_operation`: immediately persist provider IDs/task URLs; then reconcile local entity rows.
5. `finish_job`: complete only after all operations are recorded. Use `failed:true` for failures.

Expired leases and ambiguous operations require operator review. They are not silently retried.
A network timeout may mean the provider already charged or created an entity. Resolve that state
before retrying. See [engine recovery](ENGINE_RECOVERY.md). Generation rows use unique slot keys.

`sync_account` records today's full-account spend, external active budgets, timezone and currency.
`action_operation` validates/claims an optimization proposal and reserves scale headroom;
`finish_operation` then `finish_action` records success and updates local status/budgets.
The gateway is engine-only; viewer accounts cannot mutate data. Direct connector access remains
trusted: an engine must not bypass gateway refusals with ad-hoc SQL or direct Meta calls.

No background worker or scheduler is bundled. Running the web server does not drain jobs. Configure
a separate scheduler for monitoring if desired, and ensure only leased work is executed.

## Spend and optimization controls

- Launch, activation and scaling check an aggregate daily budget allowance under a transaction lock.
  Paused/launched drafts retain reservations, conservatively preventing concurrent over-allocation.
  External active budgets from the full-account sync count against the allowance too.
- Activation/scaling refuse missing, stale or mismatched account sync. Defaults require data no older
  than 60 minutes, in the configured account timezone and USD.
- Account spend at or above the threshold proposes **only** a kill switch. The engine pauses all
  active entities, including untracked ones, and stops that run.
- Recent windows use 7 days by default. Incomplete/stale ads do not qualify for scaling. Period
  frequency comes from aggregate provider insights, never a daily average.
- Sales/leads with excessive zero-conversion spend are paused. Conversion campaigns require actual
  conversions to scale; sales additionally require target ROAS. High CTR alone can scale traffic only.
- Budget increases are deduplicated per ad set with a 24-hour executed-action cooldown; any weak,
  unmanaged or stale active sibling blocks scaling. Settings cap the increase at 20%.

The evaluator prints proposals and, by default, stores them with `executed=0`. `--preview` prints
without inserting proposals. It never calls Meta itself. Pending proposals expire after 30 minutes.

Account polling cannot guarantee a hard real-time spend cap. Configure Meta's own spending controls
independently. Reservations are safety headroom, not a promise of delivery cost or profit.

## Sessions and media

Login creates a random, individually revocable eight-hour HttpOnly cookie, Secure in production and
SameSite=Strict. Sign out deletes that session. Password/role changes invalidate the user's old
sessions. Login attempts are rate limited in Postgres; cross-origin writes are rejected. Production
fails closed if credentials or database access are unavailable. A viewer can read but cannot write.

For durable media, create a public Supabase bucket and configure engine-only storage credentials.
Upload with `npm run upload-media -- FILE [CREATIVE_ID]`. The optional ID attaches media to an
unlaunched creative and invalidates its approval. Supported files: PNG/JPEG/WebP/MP4 up to 250 MB.
Generated local `public/assets` files are ignored backups and are not deployed. Approval/launch
requires a hosted HTTPS asset. Long-form video instructions upload stitched output instead of
leaving a local-only URL. Verify video audio and asset accessibility before launch.

## Commands and checks

| Command | Behavior |
| --- | --- |
| `npm run dev` / `build` / `start` | Local server / production build / production server |
| `npm run migrate` | Check and apply administrator migrations |
| `npm run lint` / `typecheck` / `test` | ESLint / TypeScript / rule and database/API regressions |
| `npm run rules -- --preview` | Preview optimization recommendations without proposal writes |
| `npm run rules` | Insert deduplicated recommendations |
| `npm run engine -- '<JSON>'` | Authenticated engine gateway request |
| `npm run upload-media -- FILE [ID]` | Upload durable media and optionally attach it |

GitHub Actions runs reproducible installation, lint, tests, build, types and dependency audit.
The suite exercises a migrated embedded Postgres engine over the PostgreSQL wire protocol as well
as pure rule/validation cases. Live Supabase, Meta publishing and paid generation were not tested.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Locked / 503 | Configure strong app credentials and verify migrations, TLS and DB connection |
| 401 | Sign in or verify the separate engine token |
| 403 | Viewer account or rejected cross-origin request |
| 409 during edit | Refresh/discard stale changes; use the current creative version |
| Launch rejected | Hosted media, saved copy, current approval, existing ICP and available reservation |
| Activation/scaling rejected | Refresh full-account sync, check spend, timezone/currency and cooldown |
| Pending jobs | Invoke the correct leased engine workflow |
| `needs_review` / unresolved operation | Reconcile provider state before any retry |
| Broken hosted media | Upload to durable storage; check bucket public access |
| Migration rejects legacy JSON | Inspect/repair the offending data in staging; never discard it blindly |
