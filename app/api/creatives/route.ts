import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const briefId = req.nextUrl.searchParams.get("brief_id");
  const status = req.nextUrl.searchParams.get("status");
  const rows = await sql`
    SELECT c.*, b.product, b.landing_url
    FROM creatives c LEFT JOIN briefs b ON b.id = c.brief_id
    WHERE true
      ${briefId ? sql`AND c.brief_id = ${briefId}` : sql``}
      ${status ? sql`AND c.status = ${status}` : sql``}
    ORDER BY c.id DESC`;
  return NextResponse.json(rows);
}

const ALLOWED = ["primary_text", "headline", "description", "cta", "status", "hook"] as const;

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  const cols = ALLOWED.filter((k) => k in b);
  if (!cols.length || !b.id) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  await sql`UPDATE creatives SET ${sql(b, ...cols)} WHERE id = ${b.id}`;
  return NextResponse.json({ ok: true });
}
