import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb()
    .prepare(
      `SELECT ea.*, a.name as ad_name, c.name as campaign_name
       FROM engine_actions ea
       LEFT JOIN ads a ON a.id = ea.ad_id
       LEFT JOIN campaigns c ON c.id = ea.campaign_id
       ORDER BY ea.id DESC LIMIT 100`
    )
    .all();
  return NextResponse.json(rows);
}
