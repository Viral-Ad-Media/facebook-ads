import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const db = getDb();
  const rows = query
    ? db
        .prepare(
          "SELECT * FROM competitor_ads WHERE query = ? ORDER BY starred DESC, started_at ASC"
        )
        .all(query)
    : db
        .prepare("SELECT * FROM competitor_ads ORDER BY starred DESC, collected_at DESC LIMIT 200")
        .all();
  const queries = db
    .prepare("SELECT query, COUNT(*) c, MAX(collected_at) last FROM competitor_ads GROUP BY query ORDER BY last DESC")
    .all();
  return NextResponse.json({ ads: rows, queries });
}

// Queue a competitor scan for the engine (Meta Ads Library search).
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
  const info = getDb()
    .prepare("INSERT INTO jobs (type, payload) VALUES ('competitor_scan', ?)")
    .run(JSON.stringify({ query: b.query.trim(), country: b.country ?? "US", limit: b.limit ?? 25 }));
  return NextResponse.json({ job_id: info.lastInsertRowid });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  getDb().prepare("UPDATE competitor_ads SET starred = ? WHERE id = ?").run(b.starred ? 1 : 0, b.id);
  return NextResponse.json({ ok: true });
}
