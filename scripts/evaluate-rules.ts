/**
 * Deterministic optimization rules engine.
 *
 * Reads the hosted performance DB + guardrail settings and prints proposed
 * actions as JSON. It NEVER touches Facebook itself — the /monitor skill
 * (Claude Code) executes the actions via the Facebook Ads connector and
 * marks them executed in engine_actions.
 *
 * Run: npm run rules   (needs DATABASE_URL in .env.local)
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may come from the shell */
}

import { sql, getAllSettings } from "../lib/db";

interface ProposedAction {
  ad_id: number | null;
  campaign_id: number | null;
  action: "pause" | "activate" | "scale_budget" | "flag" | "kill_switch" | "regenerate_queued";
  reason: string;
  metrics_snapshot: Record<string, unknown>;
  params?: Record<string, unknown>;
}

async function main() {
  const s = await getAllSettings();

  const minImpressions = Number(s.min_impressions_before_action);
  const minSpend = Number(s.min_spend_cents_before_action);
  const targetCpa = Number(s.target_cpa_cents);
  const ctrFloor = Number(s.ctr_floor);
  const scaleStepPct = Number(s.scale_step_pct);
  const fatigueFrequency = Number(s.fatigue_frequency);
  const maxDailySpend = Number(s.max_daily_spend_cents);

  const actions: ProposedAction[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ── Kill switch: account-wide spend today over guardrail ──────────────────
  const [todaySpend] = await sql`
    SELECT COALESCE(SUM(spend_cents),0)::int c FROM metrics_daily WHERE date = ${today}`;
  if (todaySpend.c > maxDailySpend) {
    actions.push({
      ad_id: null,
      campaign_id: null,
      action: "kill_switch",
      reason: `Account spend today $${(todaySpend.c / 100).toFixed(2)} exceeds guardrail $${(maxDailySpend / 100).toFixed(2)} — pause all active ads`,
      metrics_snapshot: { today_spend_cents: todaySpend.c, max_daily_spend_cents: maxDailySpend },
    });
  }

  // ── Per-ad rules ───────────────────────────────────────────────────────────
  const ads = (await sql`
    SELECT a.id, a.name, a.status, a.engine_managed, a.creative_id,
           s.campaign_id, s.daily_budget_cents, s.id as ad_set_id
    FROM ads a JOIN ad_sets s ON s.id = a.ad_set_id
    WHERE a.status IN ('active','paused') AND a.fb_ad_id IS NOT NULL`) as any[];

  for (const ad of ads) {
    if (!ad.engine_managed) continue;

    const [t] = (await sql`
      SELECT COALESCE(SUM(impressions),0)::int impressions, COALESCE(SUM(clicks),0)::int clicks,
             COALESCE(SUM(spend_cents),0)::int spend_cents, COALESCE(SUM(conversions),0)::int conversions,
             COALESCE(AVG(frequency),0)::float8 frequency
      FROM metrics_daily WHERE ad_id = ${ad.id}`) as any[];

    const ctr = t.impressions > 0 ? (100 * t.clicks) / t.impressions : 0;
    const cpa = t.conversions > 0 ? t.spend_cents / t.conversions : null;
    const snapshot = { ...t, ctr: Number(ctr.toFixed(3)), cpa_cents: cpa };

    // Data threshold: not enough signal yet → leave it alone.
    if (t.impressions < minImpressions || t.spend_cents < minSpend) continue;
    if (ad.status !== "active") continue;

    // Pause rules
    if (cpa !== null && cpa > 1.5 * targetCpa) {
      actions.push({
        ad_id: ad.id, campaign_id: ad.campaign_id, action: "pause",
        reason: `CPA $${(cpa / 100).toFixed(2)} > 1.5× target $${(targetCpa / 100).toFixed(2)}`,
        metrics_snapshot: snapshot,
      });
      continue;
    }
    if (ctr < ctrFloor) {
      actions.push({
        ad_id: ad.id, campaign_id: ad.campaign_id, action: "pause",
        reason: `CTR ${ctr.toFixed(2)}% below floor ${ctrFloor}% after ${t.impressions.toLocaleString()} impressions`,
        metrics_snapshot: snapshot,
      });
      continue;
    }

    // Fatigue: high frequency or 3 consecutive days of declining CTR
    const last3 = (await sql`
      SELECT date, CASE WHEN impressions>0 THEN (100.0*clicks/impressions)::float8 ELSE 0 END ctr
      FROM metrics_daily WHERE ad_id = ${ad.id} ORDER BY date DESC LIMIT 3`) as {
      date: string;
      ctr: number;
    }[];
    const decaying =
      last3.length === 3 && last3[0].ctr < last3[1].ctr && last3[1].ctr < last3[2].ctr;
    if (t.frequency > fatigueFrequency || decaying) {
      actions.push({
        ad_id: ad.id, campaign_id: ad.campaign_id, action: "pause",
        reason: t.frequency > fatigueFrequency
          ? `Creative fatigue: frequency ${t.frequency.toFixed(1)} > ${fatigueFrequency}`
          : `Creative fatigue: CTR declined 3 days straight (${last3.map((d) => d.ctr.toFixed(2)).join(" ← ")})`,
        metrics_snapshot: snapshot,
      });
      actions.push({
        ad_id: ad.id, campaign_id: ad.campaign_id, action: "regenerate_queued",
        reason: "Queue fresh creative variants to replace fatigued ad",
        metrics_snapshot: snapshot,
        params: { creative_id: ad.creative_id },
      });
      continue;
    }

    // Scale rule: beating target, not scaled in last 24h, stays under guardrail
    const beatingCpa = cpa !== null && cpa < targetCpa;
    const strongCtr = ctr >= 2 * ctrFloor && cpa === null; // traffic campaigns without conv tracking
    if (beatingCpa || strongCtr) {
      const [recentScale] = await sql`
        SELECT COUNT(*)::int c FROM engine_actions
        WHERE ad_id = ${ad.id} AND action='scale_budget' AND executed=1
        AND created_at > now() - interval '1 day'`;
      const newBudget = Math.round(ad.daily_budget_cents * (1 + scaleStepPct / 100));
      if (recentScale.c === 0 && newBudget <= maxDailySpend) {
        actions.push({
          ad_id: ad.id, campaign_id: ad.campaign_id, action: "scale_budget",
          reason: beatingCpa
            ? `CPA $${(cpa! / 100).toFixed(2)} beats target $${(targetCpa / 100).toFixed(2)} — scale ad set budget +${scaleStepPct}%`
            : `CTR ${ctr.toFixed(2)}% ≥ 2× floor — scale ad set budget +${scaleStepPct}%`,
          metrics_snapshot: snapshot,
          params: {
            ad_set_id: ad.ad_set_id,
            current_budget_cents: ad.daily_budget_cents,
            new_budget_cents: newBudget,
          },
        });
      }
    }
  }

  // Record proposals (executed=0) so the dashboard shows them even before execution.
  const proposalIds: number[] = [];
  for (const a of actions) {
    const [row] = await sql`
      INSERT INTO engine_actions (ad_id, campaign_id, action, reason, metrics_snapshot, executed)
      VALUES (${a.ad_id}, ${a.campaign_id}, ${a.action}, ${a.reason},
              ${JSON.stringify({ ...a.metrics_snapshot, params: a.params ?? null })}, 0)
      RETURNING id`;
    proposalIds.push(row.id);
  }

  console.log(
    JSON.stringify(
      { proposed: actions.map((a, i) => ({ engine_action_id: proposalIds[i], ...a })) },
      null,
      2
    )
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
