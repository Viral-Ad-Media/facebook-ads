import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const ads = query
    ? await sql`SELECT * FROM competitor_ads WHERE query = ${query} ORDER BY starred DESC, started_at ASC`
    : await sql`SELECT * FROM competitor_ads ORDER BY starred DESC, collected_at DESC LIMIT 200`;
  const queries = await sql`
    SELECT query, COUNT(*)::int c, MAX(collected_at) last
    FROM competitor_ads GROUP BY query ORDER BY last DESC`;
  return NextResponse.json({ ads, queries });
}

// Queue a competitor scan for the engine (Meta Ads Library search).
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
  const [row] = await sql`
    INSERT INTO jobs (type, payload) VALUES ('competitor_scan', ${JSON.stringify({
      query: b.query.trim(),
      country: b.country ?? "US",
      limit: b.limit ?? 25,
    })})
    RETURNING id`;
  return NextResponse.json({ job_id: row.id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await sql`UPDATE competitor_ads SET starred = ${b.starred ? 1 : 0} WHERE id = ${b.id}`;
  return NextResponse.json({ ok: true });
}
