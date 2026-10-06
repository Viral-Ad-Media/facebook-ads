import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignSchema,
  creativePatchSchema,
  settingsPatchSchema,
  icpSchema,
  toggleSchema,
  accountDate,
  briefSchema,
  httpsUrl,
} from "../lib/validation";
import { requireCreative } from "../lib/safety";
const campaign = {
  name: "Test",
  objective: "OUTCOME_SALES",
  daily_budget_cents: 1500,
  icp_id: 1,
  creative_ids: [1],
};
test("launch schema rejects activation flag, invalid budgets and repeated IDs", () => {
  for (const patch of [
    { activate_immediately: true },
    { daily_budget_cents: -1 },
    { daily_budget_cents: 1.5 },
    { creative_ids: [] },
    { creative_ids: [1, 1] },
    { icp_id: 0 },
  ])
    assert.equal(
      campaignSchema.safeParse({ ...campaign, ...patch }).success,
      false,
    );
});
test("job endpoint accepts exactly one typed toggle; generation cannot be injected", () => {
  assert.equal(
    toggleSchema.safeParse({ type: "generate_creative", payload: {} }).success,
    false,
  );
  assert.equal(
    toggleSchema.safeParse({
      type: "launch_campaign",
      payload: {
        campaign_id: 1,
        set_ad_status: { ad_id: 1, status: "active" },
        set_campaign_status: { status: "paused" },
      },
    }).success,
    false,
  );
});
test("settings reject unknown keys, nonfinite values and excessive scale", () => {
  for (const patch of [
    { max_daily_spend_cents: "NaN" },
    { ctr_floor: "-1" },
    { scale_step_pct: "21" },
    { currency: "EUR" },
    { arbitrary: "1" },
    { account_timezone: "invalid" },
  ])
    assert.equal(settingsPatchSchema.safeParse(patch).success, false);
});
test("ICP and briefs enforce bounded choices and URLs", () => {
  assert.equal(
    icpSchema.safeParse({ age_min: 55, age_max: 25 }).success,
    false,
  );
  assert.equal(
    briefSchema.safeParse({
      product: "Test",
      landing_url: "javascript:alert(1)",
      icp_id: 1,
    }).success,
    false,
  );
  assert.equal(
    httpsUrl.safeParse("https://user:password@example.com").success,
    false,
  );
});
test("creative edits require a version and bounded copy", () => {
  assert.equal(
    creativePatchSchema.safeParse({ id: 1, headline: "Test" }).success,
    false,
  );
  assert.equal(
    creativePatchSchema.safeParse({
      id: 1,
      version: 0,
      primary_text: "x".repeat(126),
    }).success,
    false,
  );
});
test("preflight rejects outdated approvals and local-only assets", () => {
  const c = {
    status: "approved",
    version: 1,
    approved_version: 1,
    primary_text: "Hello",
    headline: "Title",
    description: "",
    cta: "LEARN_MORE",
    format: "feed_square",
    media_type: "image",
    asset_url: "https://example.com/a.png",
    landing_url: "https://example.com/",
  };
  assert.doesNotThrow(() => requireCreative(c));
  assert.throws(() => requireCreative({ ...c, approved_version: 0 }));
  assert.throws(() =>
    requireCreative({ ...c, asset_url: null, asset_path: "/assets/local.png" }),
  );
});
test("account date follows configured timezone at midnight UTC", () =>
  assert.equal(
    accountDate("America/Chicago", new Date("2026-10-06T01:00:00Z")),
    "2026-10-05",
  ));
