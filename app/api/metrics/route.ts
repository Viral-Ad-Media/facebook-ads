import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Daily account-wide (or per-campaign) time series for dashboard charts.
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  const db = getDb();
  let sql = `
    SELECT m.date,
      SUM(m.impressions) impressions, SUM(m.clicks) clicks, SUM(m.spend_cents) spend_cents,
      SUM(m.conversions) conversions,
      CASE WHEN SUM(m.impressions) > 0 THEN ROUND(100.0 * SUM(m.clicks) / SUM(m.impressions), 2) ELSE 0 END ctr,
      CASE WHEN SUM(m.conversions) > 0 THEN SUM(m.spend_cents) / SUM(m.conversions) ELSE 0 END cpa_cents
    FROM metrics_daily m`;
  const params: unknown[] = [];
  if (campaignId) {
    sql += `
    JOIN ads a ON a.id = m.ad_id
    JOIN ad_sets s ON s.id = a.ad_set_id
    WHERE s.campaign_id = ?`;
    params.push(campaignId);
  }
  sql += " GROUP BY m.date ORDER BY m.date";
  return NextResponse.json(db.prepare(sql).all(...params));
}
