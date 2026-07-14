import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`SELECT * FROM icp_profiles ORDER BY id`;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const [row] = await sql`
    INSERT INTO icp_profiles (name, description, age_min, age_max, genders, geo, interests, pain_points, tone)
    VALUES (${b.name ?? "New ICP"}, ${b.description ?? ""}, ${b.age_min ?? 25}, ${b.age_max ?? 55},
            ${b.genders ?? "all"}, ${b.geo ?? "US"}, ${b.interests ?? ""}, ${b.pain_points ?? ""},
            ${b.tone ?? "confident, direct"})
    RETURNING id`;
  return NextResponse.json({ id: row.id });
}

export async function PUT(req: NextRequest) {
  const b = await req.json();
  await sql`
    UPDATE icp_profiles SET name=${b.name}, description=${b.description}, age_min=${b.age_min},
      age_max=${b.age_max}, genders=${b.genders}, geo=${b.geo}, interests=${b.interests},
      pain_points=${b.pain_points}, tone=${b.tone}
    WHERE id=${b.id}`;
  return NextResponse.json({ ok: true });
}
