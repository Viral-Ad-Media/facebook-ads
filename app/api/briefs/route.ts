import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const briefs = db
    .prepare(
      `SELECT b.*, i.name as icp_name,
        (SELECT COUNT(*) FROM creatives c WHERE c.brief_id = b.id) as creative_count
       FROM briefs b LEFT JOIN icp_profiles i ON i.id = b.icp_id
       ORDER BY b.id DESC`
    )
    .all();
  return NextResponse.json(briefs);
}

// Creating a brief also queues a generate_creative job for the engine.
export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO briefs (icp_id, product, offer, angle, landing_url, formats, media_types, variant_count, notes, status)
       VALUES (@icp_id, @product, @offer, @angle, @landing_url, @formats, @media_types, @variant_count, @notes, 'generating')`
    )
    .run({
      icp_id: b.icp_id ?? null,
      product: b.product,
      offer: b.offer ?? "",
      angle: b.angle ?? "",
      landing_url: b.landing_url ?? "",
      formats: b.formats ?? "feed_square,story_vertical",
      media_types: b.media_types ?? "image",
      variant_count: b.variant_count ?? 2,
      notes: b.notes ?? "",
    });
  const briefId = info.lastInsertRowid;
  db.prepare("INSERT INTO jobs (type, payload) VALUES ('generate_creative', ?)").run(
    JSON.stringify({ brief_id: briefId })
  );
  return NextResponse.json({ id: briefId });
}
