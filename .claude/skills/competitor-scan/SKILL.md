---
name: competitor-scan
description: Drain pending competitor_scan jobs — search the Meta Ads Library via the Facebook Ads connector for a brand/keyword, store competitors' running ads in the local database, and analyze what makes the long-running ones work.
---

# Competitor ad scan

You are the competitive-intelligence engine for the Facebook Ads Studio app. Execute every pending `competitor_scan` job.

## Steps

**Database access:** hosted Postgres (Supabase project the `SUPABASE_PROJECT_ID` from `.env.local`, schema `fbads`). Run all SQL with the Supabase MCP tool `execute_sql`, always qualifying tables as `fbads.<table>`.

1. **Read pending jobs**:
   ```sql
   SELECT * FROM fbads.jobs WHERE status='pending' AND type='competitor_scan' ORDER BY id
   ```
   Mark each running before working on it. Payload: `{ query, country, limit }`.

2. **Search the Meta Ads Library** with the Facebook Ads connector tool `ads_library_search` (search term = `query`, country = `country`, active ads only if the tool supports it). If the query looks like a brand, also try it as a page name search when the tool offers that mode.

3. **Store each result** in `fbads.competitor_ads` (`INSERT ... ON CONFLICT (library_id) DO NOTHING` — `library_id` is unique):
   - `query`, `page_name`, `library_id`, `body`, `headline`, `cta`
   - `media_type` (image/video/carousel), `media_url` (first image/video thumbnail if exposed), `snapshot_url` (the Ads Library link)
   - `started_at` = ad delivery start date (this is the **winning signal** — an ad still running after 60+ days is profitable)
   - `platforms` = comma-joined publisher platforms

4. **Analyze the winners**: for ads running ≥ 60 days (or the longest-running handful), write one sentence into the `analysis` column naming the hook type, angle, offer structure, and format choice (e.g. "Problem-agitate hook with UGC-style video and a free-trial offer — social proof in the first line"). Base this on the ad text you stored; do not invent details.

5. **Cross-query patterns → learnings**: if a clear pattern shows up across the scanned set (e.g. every long-runner is a video, or all lead with a discount), upsert a `learnings` row with `dimension` = hook/format/offer, the insight, `evidence` = "Ads Library scan: <query>", confidence ~0.4 (observational, not our own data).

6. **Finish each job**: `UPDATE fbads.jobs SET status='done', result=?, finished_at=now() WHERE id=?` (result = count stored). On tool failure, mark the job failed with the error and report.

7. **Report**: how many ads stored per query, the top 3 longest-running with their angle analysis, and point the user to the Competitors page (locally http://localhost:3100/competitors or the deployed Vercel URL) — the "Use as inspiration" button pre-fills a new brief from any card.

## Rules
- Read-only against Facebook — this skill never creates or modifies ads.
- Store competitor copy verbatim for analysis, but when the user later builds ads from it, take the *angle*, never copy the text.
