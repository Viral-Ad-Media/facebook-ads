import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const briefs = await sql`
    SELECT b.*, i.name as icp_name,
      (SELECT COUNT(*)::int FROM creatives c WHERE c.brief_id = b.id) as creative_count
    FROM briefs b LEFT JOIN icp_profiles i ON i.id = b.icp_id
    ORDER BY b.id DESC`;
  return NextResponse.json(briefs);
}

// Creating a brief also queues a generate_creative job for the engine.
export async function POST(req: NextRequest) {
  const b = await req.json();
  const [row] = await sql`
    INSERT INTO briefs (icp_id, product, offer, angle, landing_url, formats, media_types, variant_count, notes, status)
    VALUES (${b.icp_id ?? null}, ${b.product}, ${b.offer ?? ""}, ${b.angle ?? ""}, ${b.landing_url ?? ""},
            ${b.formats ?? "feed_square,story_vertical"}, ${b.media_types ?? "image"},
            ${b.variant_count ?? 2}, ${b.notes ?? ""}, 'generating')
    RETURNING id`;
  await sql`INSERT INTO jobs (type, payload) VALUES ('generate_creative', ${JSON.stringify({ brief_id: row.id })})`;
  return NextResponse.json({ id: row.id });
}
