# Facebook Ads Studio

A local ad studio + campaign engine for Facebook/Meta advertising. Generate creatives with
Higgsfield, preview them exactly as they'll appear on Facebook, launch real campaigns with one
click, and let a guardrailed optimization engine monitor and improve them — with every metric and
decision stored in a local SQLite performance database.

![stack](https://img.shields.io/badge/Next.js%2014-black) ![db](https://img.shields.io/badge/SQLite-better--sqlite3-blue) ![engine](https://img.shields.io/badge/engine-Claude%20Code-orange)

## How it works

```
┌─ Web app (localhost:3100) ─────────────┐      ┌─ Claude Code (engine) ──────────────┐
│ Competitors (Meta Ads Library scans)   │      │ /competitor-scan → ads_library      │
│ Ad Studio (brief → variants → preview) │ jobs │ /process-jobs    → Higgsfield gen   │
│ Launch panel (targeting, budget)       │◄────►│ /launch          → FB connector     │
│ Campaigns dashboard + action log       │SQLite│ /monitor         → insights + rules │
│ Learnings + Settings (ICP, guardrails) │      │ (scheduled every ~6h)               │
└────────────────────────────────────────┘      └─────────────────────────────────────┘
                    data/ads.db  +  public/assets/ (generated media)
```

The web UI never talks to Facebook or Higgsfield directly. Buttons queue rows in a `jobs` table;
Claude Code drains the queue through its connected MCP connectors (Facebook Ads + Higgsfield) and
writes results back to the database, which the UI polls.

## Features

- **Competitor analysis** — scan the Meta Ads Library for any brand/keyword; ads running 60+ days
  are flagged as winners with an angle analysis; one click turns any of them into a new brief.
- **Ad Studio** — brief in, variants out: AI copy (with hard Facebook character limits enforced)
  plus Higgsfield images/videos in every placement format (1:1, 4:5, 9:16, 1.91:1), rendered in
  pixel-faithful Feed and Story/Reel previews.
- **One-click launch** — ICP profiles map to Facebook targeting specs; budget slider with
  learning-phase-aware recommended spend; campaigns are always created **PAUSED** first.
- **Optimization engine** — deterministic rules with guardrails: data thresholds before any action,
  CPA/CTR pause rules, +20% budget scaling for winners (max 1×/24h), creative-fatigue detection
  that queues regeneration, and an account-level daily-spend kill switch. Every action is logged.
- **Performance database & learnings** — all metrics live in local SQLite; the engine mines
  what works (hooks, formats, audiences) and pre-fills future briefs with it.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3100 — DB auto-creates and seeds on first request
```

Open the app in a Claude Code session that has the **Facebook Ads** and **Higgsfield** connectors
attached. The workflow:

1. **Settings** — set your Facebook Page ID and review engine guardrails.
2. **Competitors** — scan a brand → run `/competitor-scan`.
3. **Ad Studio** — create a brief → run `/process-jobs` → preview & approve variants.
4. **Launch** — pick creatives, budget, ICP → *Launch to Facebook* → run `/launch` → activate from
   the dashboard.
5. **Monitor** — run `/monitor` (or schedule it) to sync insights, act within guardrails, and
   collect learnings.

`npm run rules` dry-runs the optimization rules against the local DB and prints proposed actions.

## Safety model

- Nothing on Facebook is ever created active — PAUSED first, explicit activation required.
- No budget may exceed the `max_daily_spend_cents` guardrail; a kill switch pauses everything if
  account daily spend crosses it.
- Every Facebook mutation is written to the `engine_actions` audit log and shown in the dashboard.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · better-sqlite3 · Recharts · Claude Code
skills (`.claude/skills/`) as the execution engine.
