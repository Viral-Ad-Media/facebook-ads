import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const campaigns = db
    .prepare(
      `SELECT c.*, i.name as icp_name FROM campaigns c
       LEFT JOIN icp_profiles i ON i.id = c.icp_id ORDER BY c.id DESC`
    )
    .all() as any[];
  for (const c of campaigns) {
    c.ad_sets = db.prepare("SELECT * FROM ad_sets WHERE campaign_id = ?").all(c.id) as any[];
    for (const s of c.ad_sets) {
      s.ads = db
        .prepare(
          `SELECT a.*, cr.headline, cr.asset_path, cr.asset_url, cr.media_type, cr.format
           FROM ads a LEFT JOIN creatives cr ON cr.id = a.creative_id
           WHERE a.ad_set_id = ?`
        )
        .all(s.id) as any[];
      for (const ad of s.ads) {
        ad.totals = db
          .prepare(
            `SELECT COALESCE(SUM(impressions),0) impressions, COALESCE(SUM(clicks),0) clicks,
              COALESCE(SUM(spend_cents),0) spend_cents, COALESCE(SUM(conversions),0) conversions,
              CASE WHEN SUM(impressions) > 0 THEN 100.0 * SUM(clicks) / SUM(impressions) ELSE 0 END ctr,
              COALESCE(AVG(frequency),0) frequency
             FROM metrics_daily WHERE ad_id = ?`
          )
          .get(ad.id);
      }
    }
  }
  return NextResponse.json(campaigns);
}

// Queue a launch: creates local campaign draft + launch_campaign job.
export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO campaigns (name, objective, status, daily_budget_cents, icp_id)
       VALUES (@name, @objective, 'launching', @daily_budget_cents, @icp_id)`
    )
    .run({
      name: b.name,
      objective: b.objective ?? "OUTCOME_TRAFFIC",
      daily_budget_cents: b.daily_budget_cents ?? 1500,
      icp_id: b.icp_id ?? null,
    });
  const campaignId = info.lastInsertRowid;
  db.prepare("INSERT INTO jobs (type, payload) VALUES ('launch_campaign', ?)").run(
    JSON.stringify({
      campaign_id: campaignId,
      creative_ids: b.creative_ids ?? [],
      activate_immediately: !!b.activate_immediately,
    })
  );
  return NextResponse.json({ id: campaignId });
}
