---
name: monitor
description: Sync Facebook campaign insights into the local performance database, run the guardrail rules engine, execute pause/activate/scale actions on Facebook, and extract learnings for future ads. Designed to run on a schedule.
---

# Monitor & optimize live campaigns

You are the optimization engine for the Facebook Ads Studio app. One run = sync → rules → act → learn.

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

## Required execution protocol

Use the authenticated engine gateway; never claim jobs or mark completion using ad-hoc SQL.
Set `ENGINE_BASE_URL` and `ENGINE_TOKEN` in `.env.local` on the engine machine. A worker ID is a
fresh UUID for this engine session. Commands use `npm run engine -- '<JSON>'`.

- Claim one job atomically: `{"command":"claim","worker":"<UUID>","types":["<TYPE>"]}`.
  Process only the returned job. An empty result means stop. Expired running jobs become
  `needs_review`; do not reset/retry them without reconciling all provider IDs and billing effects.
- Renew the lease before ten minutes: `{"command":"heartbeat","worker":"<UUID>","job_id":1}`.
  Stop immediately on lease loss. Heartbeat during provider polling and between steps.
- Before each paid generation or Meta mutation, request a checkpoint/permit:
  `{"command":"job_operation","worker":"<UUID>","job_id":1,"step":"<STEP>"}`.
  Valid steps include `campaign:create`, `adset:create`, `creative:1:create`, `ad:1:create`,
  `toggle:status`, `generation:1:generate`. Number slots deterministically across formats/variants.
  A returned `already_done` means use its recorded result and skip the provider call.
  A 409 means reconcile provider state; never call the provider again speculatively.
  Permits expire after 60 seconds: make exactly one intended provider call promptly.
- Immediately after success, persist every provider ID or task/asset URL using
  `{"command":"finish_operation","worker":"<UUID>","key":"<RETURNED_KEY>","result":{...}}`.
  For async generation, persist the task ID before polling; resume polling the same task.
  A conclusive primary generation failure may be checkpointed as failed and followed by a
  distinct deterministic `generation:<SLOT>:fallback` operation; ambiguous failures require review.
  Save Meta IDs to local campaign/ad-set/ad rows immediately after their operation checkpoint,
  never only at the end. Recover rows from recorded results without recreating remote entities.
- On ambiguous timeout/crash, leave the operation in-flight and flag the job for reconciliation.
  Do not release its spend reservation. Confirm Meta/provider state before operator recovery.
- Complete with `{"command":"finish_job","worker":"<UUID>","job_id":1,"result":{...}}`.
  On failure add `"failed":true`. Unresolved operations produce `needs_review`.

Generation rows must use a unique `generation_key` such as `job:<ID>:slot:<N>` and
`INSERT ... ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO NOTHING`.
Do not call a provider for a slot with an existing operation or creative. Copy-only failures may
be stored generated, but they cannot be approved or launched until hosted media is attached.

Never edit or activate an outdated approved version. Gateway preflight validates copy, URLs,
creative version and the aggregate budget reservation. All new campaigns stay PAUSED; the
API does not accept immediate activation. Explicit dashboard status requests are separate jobs.
Never bypass a gateway refusal with direct SQL or a connector call.

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

Before mutation call action_operation. After success call finish_operation and finish_action. If execution fails, leave the operation unresolved and report the error for reconciliation.

## 4 · Extract learnings
Compare performance across `creatives.hook`, `format`, `media_type`, and ICP (join ads → creatives → briefs). Where one option clearly beats another (≥ meaningful sample, e.g. both sides past the data thresholds), upsert a row in `learnings`:
- `dimension`: hook | format | audience | offer | media_type
- `insight`: one plain-English sentence ("Time-saved hooks get 2.1× the CTR of price hooks")
- `evidence`: the numbers (JSON or short text), `confidence`: 0–1 based on sample size.
Update existing learnings on the same dimension/insight instead of duplicating (bump `updated_at`, adjust confidence).

## 5 · Report
Summarize: spend today vs guardrail, per-campaign KPIs, actions taken (and why), new learnings. If nothing had enough data, say so. Dashboard: http://localhost:3100.

## Account-wide safety sync and action execution (required)

Before rules or any activation/scaling: fetch full-account spend for today's date in
`settings.account_timezone`, the account currency, and all active campaign/ad-set budgets.
Store external (not locally reserved) daily budgets via engine command `sync_account` with
`account_id`, `account_date`, `timezone`, `currency`, `spend_cents`, `external_daily_budget_cents`.
Abort if account data cannot be fetched or currency differs from configured USD. Never infer
account spend by summing only local ads. Include untracked campaigns in spend/external budgets.

Sync per-ad daily data for the configured `lookback_days` (not a fixed seven days), including
zero-delivery days. Fetch the provider's aggregate frequency for that entire date window into
`fbads.metrics_period(ad_id,since_date,until_date,frequency,synced_at)`; never average daily
frequencies to approximate period frequency. Confirm sync completeness before running rules.

For each rule proposal use `action_operation` with worker UUID and action_id BEFORE any provider
mutation. On refusal, skip and re-evaluate. This reserves scale headroom and enforces ad-set cooldown.
Immediately record successful provider response using finish_operation, then finish_action with
worker, action_id and result. Do not directly set executed flags; finish_action updates local state.
If a kill_switch is returned, execute only its account-wide pause (including untracked active
entities), checkpoint and finish it, then STOP. Do not execute other proposals from that run.
If any pause fails, leave it unresolved for reconciliation; do not claim the account is stopped.
For regenerate_queued the side effect is queue insertion, not a media provider call; checkpoint
that intent and finish_action, which inserts a deduplicated job transactionally.

Account polling cannot enforce a real-time hard spend cap. Configure Meta's own spending limits
independently. Never override gateway safety checks or reuse expired permits.
