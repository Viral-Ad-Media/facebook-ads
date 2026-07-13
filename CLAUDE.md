# Facebook Ads Studio

Local ad studio + campaign engine. The Next.js app (port 3100) is the visual cockpit and owns the
SQLite performance database; **Claude Code is the execution engine** — it drains the `jobs` queue
using the connected MCP connectors:

- **Higgsfield connector** (`generate_image`, `generate_video`, `models_explore`) — creative generation
- **Facebook Ads connector** (`ads_*` tools) — publishing, insights, on/off, budgets

## The three skills

| Skill | Trigger | What it does |
|---|---|---|
| `/competitor-scan` | after searching on the Competitors page | pulls competitors' running ads from the Meta Ads Library (`ads_library_search`) → `competitor_ads`, analyzes long-runners (60+ days = winning) |
| `/process-jobs` | after creating a brief in the Studio | writes copy + generates Higgsfield visuals → `creatives` |
| `/launch` | after clicking "Launch to Facebook" | creates campaign → ad set → creatives → ads on FB (**always PAUSED first**), writes FB IDs back; also handles dashboard ad/campaign on/off toggles |
| `/monitor` | on a schedule (every ~6h) or on demand | syncs insights → `metrics_daily`, runs `npm run rules`, executes pause/scale/kill-switch actions, extracts `learnings` |

## Database

`data/ads.db` (WAL). Schema in `lib/schema.sql`. Key tables: `briefs → creatives`,
`campaigns → ad_sets → ads → metrics_daily`, `competitor_ads` (Ads Library scans), `engine_actions`
(audit log — every FB mutation gets a row), `learnings`, `jobs` (the queue), `settings` (guardrails
+ FB account IDs).
Query with `sqlite3 -json data/ads.db "..."`. Money is stored in **cents**.

## Safety rules

1. Everything created on Facebook starts **PAUSED**. Activation requires an explicit user signal
   (payload flag, dashboard toggle, or chat confirmation).
2. Never exceed `settings.max_daily_spend_cents` on any budget. The rules engine's kill switch
   pauses everything if account daily spend crosses it.
3. Log every Facebook mutation in `engine_actions` (executed=1) — the dashboard renders this log.
4. Facebook tool schemas are authoritative — discover exact parameter shapes at call time; on
   errors use `ads_get_errors` and report rather than retrying blindly.

## Dev

```bash
npm run dev        # app on http://localhost:3100 (DB auto-creates + seeds on first request)
npm run rules      # rules engine dry run — prints proposed actions JSON
```
