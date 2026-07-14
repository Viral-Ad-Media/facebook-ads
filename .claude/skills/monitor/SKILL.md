---
name: monitor
description: Sync Facebook campaign insights into the local performance database, run the guardrail rules engine, execute pause/activate/scale actions on Facebook, and extract learnings for future ads. Designed to run on a schedule.
---

# Monitor & optimize live campaigns

You are the optimization engine for the Facebook Ads Studio app. One run = sync → rules → act → learn.

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

## 1 · Sync insights
For every local ad with a `fb_ad_id` and status active/paused:
- Pull per-day insights via the Facebook Ads connector (`ads_insights_performance_trend` and/or the entity insights read that the tool schemas expose) for the last 7 days: impressions, reach, frequency, clicks, ctr, cpc, cpm, spend, conversions/actions.
- Upsert into `fbads.metrics_daily` (UNIQUE on ad_id+date):
  ```sql
  INSERT INTO fbads.metrics_daily (ad_id, date, impressions, reach, frequency, clicks, ctr, cpc_cents, cpm_cents, spend_cents, conversions, cpa_cents, roas) VALUES (...)
  ON CONFLICT(ad_id, date) DO UPDATE SET impressions=excluded.impressions, reach=excluded.reach, frequency=excluded.frequency, clicks=excluded.clicks, ctr=excluded.ctr, cpc_cents=excluded.cpc_cents, cpm_cents=excluded.cpm_cents, spend_cents=excluded.spend_cents, conversions=excluded.conversions, cpa_cents=excluded.cpa_cents, roas=excluded.roas, synced_at=now()
  ```
- Also reconcile statuses: if Facebook shows an ad paused/active differently than the local DB, update the local row.

## 2 · Run the rules engine
```bash
npm run rules
```
(Needs `DATABASE_URL` in `.env.local` — see `.env.example`.) It prints proposed actions as JSON and pre-logs them in `fbads.engine_actions` with `executed=0`. The rules (data thresholds, CPA/CTR pause rules, +% scaling capped by guardrails, fatigue detection, account kill switch) are deterministic — do not second-guess them, but sanity-check for obvious data problems (e.g. a sync failure producing zeros) before acting.

## 3 · Execute actions on Facebook
For each proposed action:
- `pause` → `ads_update_entity` (status PAUSED) on the fb_ad_id; local `ads.status='paused'`.
- `activate` → `ads_activate_entity`; local status 'active'.
- `scale_budget` → `ads_update_entity` on the ad set with `params.new_budget_cents` (never above `max_daily_spend_cents`); update `ad_sets.daily_budget_cents`.
- `kill_switch` → pause every active ad and campaign, then STOP and tell the user loudly.
- `regenerate_queued` → `INSERT INTO fbads.jobs (type, payload) VALUES ('regenerate', json)` with the creative_id from params.

After each success: `UPDATE fbads.engine_actions SET executed=1 WHERE id=?`. If execution fails, leave `executed=0` and append the error to the reason.

## 4 · Extract learnings
Compare performance across `creatives.hook`, `format`, `media_type`, and ICP (join ads → creatives → briefs). Where one option clearly beats another (≥ meaningful sample, e.g. both sides past the data thresholds), upsert a row in `learnings`:
- `dimension`: hook | format | audience | offer | media_type
- `insight`: one plain-English sentence ("Time-saved hooks get 2.1× the CTR of price hooks")
- `evidence`: the numbers (JSON or short text), `confidence`: 0–1 based on sample size.
Update existing learnings on the same dimension/insight instead of duplicating (bump `updated_at`, adjust confidence).

## 5 · Report
Summarize: spend today vs guardrail, per-campaign KPIs, actions taken (and why), new learnings. If nothing had enough data, say so. Dashboard: http://localhost:3100.
