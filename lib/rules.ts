import { accountDate, settingsSchema } from "./validation";
export type Daily = {
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  roas: number;
};
export type RuleAd = {
  id: number;
  campaign_id: number;
  ad_set_id: number;
  creative_id: number;
  objective: string;
  engine_managed: number;
  status: string;
  daily_budget_cents: number;
  days: Daily[];
  frequency: number | null;
  fresh: boolean;
};
export type ProposedAction = {
  ad_id: number | null;
  campaign_id: number | null;
  ad_set_id: number | null;
  action: "pause" | "scale_budget" | "kill_switch" | "regenerate_queued";
  reason: string;
  metrics_snapshot: Record<string, unknown>;
  params?: Record<string, unknown>;
};
export function evaluateRules(input: {
  settings: Record<string, string>;
  ads: RuleAd[];
  accountSpend: number;
  reservedBudget: number;
  scaledSets: Set<number>;
  pendingSets: Set<number>;
  now?: Date;
}): ProposedAction[] {
  const s = settingsSchema.parse(input.settings);
  const now = input.now ?? new Date();
  const max = Number(s.max_daily_spend_cents);
  if (input.accountSpend >= max)
    return [
      {
        ad_id: null,
        campaign_id: null,
        ad_set_id: null,
        action: "kill_switch",
        reason: "Full account spend reached daily threshold",
        metrics_snapshot: {
          spend_cents: input.accountSpend,
          max_daily_spend_cents: max,
        },
      },
    ];
  const actions: ProposedAction[] = [];
  const candidates = new Map<
    number,
    { ad: RuleAd; snapshot: Record<string, unknown> }
  >();
  const blocked = new Set<number>();
  for (const ad of input.ads) {
    if (ad.status !== "active") continue;
    if (!ad.engine_managed || !ad.fresh) {
      blocked.add(ad.ad_set_id);
      continue;
    }
    const totals = ad.days.reduce(
      (t, d) => ({
        impressions: t.impressions + d.impressions,
        clicks: t.clicks + d.clicks,
        spend_cents: t.spend_cents + d.spend_cents,
        conversions: t.conversions + d.conversions,
        revenue_cents: t.revenue_cents + d.roas * d.spend_cents,
      }),
      {
        impressions: 0,
        clicks: 0,
        spend_cents: 0,
        conversions: 0,
        revenue_cents: 0,
      },
    );
    if (
      totals.impressions < Number(s.min_impressions_before_action) ||
      totals.spend_cents < Number(s.min_spend_cents_before_action)
    ) {
      blocked.add(ad.ad_set_id);
      continue;
    }
    const ctr = (100 * totals.clicks) / totals.impressions;
    const cpa = totals.conversions
      ? totals.spend_cents / totals.conversions
      : null;
    const roas = totals.spend_cents
      ? totals.revenue_cents / totals.spend_cents
      : 0;
    const conversion = ["OUTCOME_SALES", "OUTCOME_LEADS"].includes(
      ad.objective,
    );
    const snapshot = {
      ...totals,
      ctr,
      cpa_cents: cpa,
      roas,
      frequency: ad.frequency,
      window_days: Number(s.lookback_days),
      date: accountDate(s.account_timezone, now),
    };
    let reason = "";
    let fatigue = false;
    if (
      conversion &&
      cpa === null &&
      totals.spend_cents >=
        Math.max(
          Number(s.min_spend_cents_before_action),
          1.5 * Number(s.target_cpa_cents),
        )
    )
      reason = "No conversions after spending 1.5× target CPA";
    else if (
      conversion &&
      cpa !== null &&
      cpa > 1.5 * Number(s.target_cpa_cents)
    )
      reason = "CPA exceeds 1.5× target";
    else if (ctr < Number(s.ctr_floor)) reason = "CTR below floor";
    else {
      const days = [...ad.days]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4);
      const consecutive =
        days.length === 4 &&
        days
          .slice(1)
          .every(
            (d, i) =>
              Date.parse(days[i].date) - Date.parse(d.date) === 86400000,
          );
      const dailyCtr = (d: Daily) =>
        d.impressions ? d.clicks / d.impressions : 0;
      const decaying =
        consecutive &&
        days.every((d) => d.impressions >= 100) &&
        days.slice(1).every((d, i) => dailyCtr(days[i]) < dailyCtr(d));
      fatigue =
        (ad.frequency !== null && ad.frequency > Number(s.fatigue_frequency)) ||
        decaying;
      if (fatigue)
        reason =
          "Creative fatigue: period frequency or three consecutive CTR declines";
    }
    if (reason) {
      blocked.add(ad.ad_set_id);
      actions.push({
        ad_id: ad.id,
        campaign_id: ad.campaign_id,
        ad_set_id: ad.ad_set_id,
        action: "pause",
        reason,
        metrics_snapshot: snapshot,
      });
      if (fatigue)
        actions.push({
          ad_id: ad.id,
          campaign_id: ad.campaign_id,
          ad_set_id: ad.ad_set_id,
          action: "regenerate_queued",
          reason: "Replace fatigued creative",
          metrics_snapshot: snapshot,
          params: { creative_id: ad.creative_id },
        });
      continue;
    }
    const canScale = conversion
      ? cpa !== null &&
        cpa < Number(s.target_cpa_cents) &&
        (ad.objective !== "OUTCOME_SALES" || roas >= Number(s.target_roas))
      : ad.objective === "OUTCOME_TRAFFIC" && ctr >= 2 * Number(s.ctr_floor);
    if (canScale && ad.frequency !== null)
      candidates.set(ad.ad_set_id, { ad, snapshot });
    else blocked.add(ad.ad_set_id);
  }
  let allocated = input.reservedBudget;
  for (const [set, { ad, snapshot }] of candidates) {
    if (
      blocked.has(set) ||
      input.scaledSets.has(set) ||
      input.pendingSets.has(set)
    )
      continue;
    const next = Math.round(
      ad.daily_budget_cents * (1 + Number(s.scale_step_pct) / 100),
    );
    const delta = next - ad.daily_budget_cents;
    if (delta <= 0 || allocated + delta > max) continue;
    allocated += delta;
    actions.push({
      ad_id: ad.id,
      campaign_id: ad.campaign_id,
      ad_set_id: set,
      action: "scale_budget",
      reason: "Qualified ad set; one increase per 24 hours",
      metrics_snapshot: snapshot,
      params: {
        ad_set_id: set,
        current_budget_cents: ad.daily_budget_cents,
        new_budget_cents: next,
      },
    });
  }
  return actions;
}
