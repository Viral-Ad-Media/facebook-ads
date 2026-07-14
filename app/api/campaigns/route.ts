import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const campaigns = (await sql`
    SELECT c.*, i.name as icp_name FROM campaigns c
    LEFT JOIN icp_profiles i ON i.id = c.icp_id ORDER BY c.id DESC`) as any[];
  for (const c of campaigns) {
    c.ad_sets = (await sql`SELECT * FROM ad_sets WHERE campaign_id = ${c.id}`) as any[];
    for (const s of c.ad_sets) {
      s.ads = (await sql`
        SELECT a.*, cr.headline, cr.asset_path, cr.asset_url, cr.media_type, cr.format
        FROM ads a LEFT JOIN creatives cr ON cr.id = a.creative_id
        WHERE a.ad_set_id = ${s.id}`) as any[];
      for (const ad of s.ads) {
        const [totals] = await sql`
          SELECT COALESCE(SUM(impressions),0)::int impressions, COALESCE(SUM(clicks),0)::int clicks,
            COALESCE(SUM(spend_cents),0)::int spend_cents, COALESCE(SUM(conversions),0)::int conversions,
            CASE WHEN SUM(impressions) > 0 THEN (100.0 * SUM(clicks) / SUM(impressions))::float8 ELSE 0 END ctr,
            COALESCE(AVG(frequency),0)::float8 frequency
          FROM metrics_daily WHERE ad_id = ${ad.id}`;
        ad.totals = totals;
      }
    }
  }
  return NextResponse.json(campaigns);
}

// Queue a launch: creates local campaign draft + launch_campaign job.
export async function POST(req: NextRequest) {
  const b = await req.json();
  const [row] = await sql`
    INSERT INTO campaigns (name, objective, status, daily_budget_cents, icp_id)
    VALUES (${b.name}, ${b.objective ?? "OUTCOME_TRAFFIC"}, 'launching',
            ${b.daily_budget_cents ?? 1500}, ${b.icp_id ?? null})
    RETURNING id`;
  await sql`INSERT INTO jobs (type, payload) VALUES ('launch_campaign', ${JSON.stringify({
    campaign_id: row.id,
    creative_ids: b.creative_ids ?? [],
    activate_immediately: !!b.activate_immediately,
  })})`;
  return NextResponse.json({ id: row.id });
}
