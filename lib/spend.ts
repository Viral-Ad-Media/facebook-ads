// Recommended-spend math for the launch panel.
//
// Facebook's learning phase wants ~50 optimization events per ad set per week.
// Recommended daily budget ≈ (50 conversions / 7 days) × target CPA.
// For traffic campaigns we anchor on target CPC instead, aiming for enough
// clicks per day to produce signal (≥ 30 clicks/day heuristic).

export interface SpendRecommendation {
  recommended_daily_cents: number;
  minimum_daily_cents: number;
  rationale: string;
}

export function recommendSpend(opts: {
  objective: string;
  target_cpa_cents: number;
  ad_count: number;
}): SpendRecommendation {
  const { objective, target_cpa_cents, ad_count } = opts;

  if (objective === "OUTCOME_SALES" || objective === "OUTCOME_LEADS") {
    const daily = Math.round((50 / 7) * target_cpa_cents);
    return {
      recommended_daily_cents: daily,
      minimum_daily_cents: Math.round(daily / 2),
      rationale: `Exiting the learning phase needs ~50 conversions/week. At a $${(
        target_cpa_cents / 100
      ).toFixed(0)} target CPA that is ~$${(daily / 100).toFixed(0)}/day.`,
    };
  }

  // Traffic / awareness: assume ~$0.50–1.00 CPC, want ≥30 clicks/day, plus a
  // little headroom per additional ad so each variant gets delivery.
  const base = 1500; // $15/day
  const perAd = 500; // +$5/day per extra ad
  const daily = base + Math.max(0, ad_count - 1) * perAd;
  return {
    recommended_daily_cents: daily,
    minimum_daily_cents: 1000,
    rationale: `~$${(daily / 100).toFixed(0)}/day gives every variant enough delivery (~30+ clicks/day) to compare performance within a few days.`,
  };
}
