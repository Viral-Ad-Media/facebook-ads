import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRules, RuleAd } from "../lib/rules";
import { DEFAULT_SETTINGS } from "../lib/db";
const ad = (patch: Partial<RuleAd> = {}): RuleAd => ({
  id: 1,
  campaign_id: 1,
  ad_set_id: 1,
  creative_id: 1,
  objective: "OUTCOME_TRAFFIC",
  engine_managed: 1,
  status: "active",
  daily_budget_cents: 1500,
  frequency: 1,
  fresh: true,
  days: [
    {
      date: "2026-10-06",
      impressions: 2000,
      clicks: 60,
      spend_cents: 4000,
      conversions: 0,
      roas: 0,
    },
  ],
  ...patch,
});
const run = (
  ads: RuleAd[],
  patch: Partial<Parameters<typeof evaluateRules>[0]> = {},
) =>
  evaluateRules({
    settings: DEFAULT_SETTINGS,
    ads,
    accountSpend: 1000,
    reservedBudget: 1500,
    scaledSets: new Set(),
    pendingSets: new Set(),
    now: new Date("2026-10-06T12:00:00Z"),
    ...patch,
  });
test("kill switch produces only a kill action even with scaling winners", () => {
  assert.deepEqual(
    run([ad()], { accountSpend: 5000 }).map((a) => a.action),
    ["kill_switch"],
  );
});
test("zero-conversion sales and leads pause instead of scaling on high CTR", () => {
  for (const objective of ["OUTCOME_SALES", "OUTCOME_LEADS"])
    assert.deepEqual(
      run([ad({ objective })]).map((a) => a.action),
      ["pause"],
    );
});
test("sales scaling requires conversions and target ROAS", () => {
  assert.equal(
    run([
      ad({
        objective: "OUTCOME_SALES",
        days: [
          {
            date: "2026-10-06",
            impressions: 2000,
            clicks: 60,
            spend_cents: 4000,
            conversions: 4,
            roas: 1,
          },
        ],
      }),
    ]).length,
    0,
  );
  assert.equal(
    run([
      ad({
        objective: "OUTCOME_SALES",
        days: [
          {
            date: "2026-10-06",
            impressions: 2000,
            clicks: 60,
            spend_cents: 4000,
            conversions: 4,
            roas: 3,
          },
        ],
      }),
    ])[0].action,
    "scale_budget",
  );
});
test("multiple winners sharing a set yield only one scale", () =>
  assert.equal(
    run([ad(), ad({ id: 2 })]).filter((a) => a.action === "scale_budget")
      .length,
    1,
  ));
test("one losing or stale sibling blocks scaling its set", () => {
  assert.equal(run([ad(), ad({ id: 2, fresh: false })]).length, 0);
  assert.equal(
    run([
      ad(),
      ad({
        id: 2,
        days: [
          {
            date: "2026-10-06",
            impressions: 2000,
            clicks: 1,
            spend_cents: 4000,
            conversions: 0,
            roas: 0,
          },
        ],
      }),
    ]).filter((a) => a.action === "scale_budget").length,
    0,
  );
});
test("aggregate allowance includes other campaigns and external budgets", () =>
  assert.equal(
    run([ad(), ad({ id: 2, ad_set_id: 2 })], { reservedBudget: 4800 }).length,
    0,
  ));
test("set-level cooldown and pending proposal block scaling", () => {
  assert.equal(run([ad()], { scaledSets: new Set([1]) }).length, 0);
  assert.equal(run([ad()], { pendingSets: new Set([1]) }).length, 0);
});
test("missing period frequency blocks scale, daily averages are not substituted", () =>
  assert.equal(run([ad({ frequency: null })]).length, 0));
test("fatigue requires four consecutive dates for three declines", () => {
  const days = [6, 5, 4, 3].map((d, i) => ({
    date: `2026-10-0${d}`,
    impressions: 1000,
    clicks: 20 + i * 10,
    spend_cents: 500,
    conversions: 0,
    roas: 0,
  }));
  assert.deepEqual(
    run([ad({ days })]).map((a) => a.action),
    ["pause", "regenerate_queued"],
  );
  assert.equal(
    run([
      ad({
        days: days.map((d, i) => (i === 3 ? { ...d, date: "2026-10-01" } : d)),
      }),
    ]).some((a) => a.action === "regenerate_queued"),
    false,
  );
});
test("invalid settings fail instead of silently disabling safety checks", () =>
  assert.throws(() =>
    run([ad()], {
      settings: { ...DEFAULT_SETTINGS, max_daily_spend_cents: "NaN" },
    }),
  ));
