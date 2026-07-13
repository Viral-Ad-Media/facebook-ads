import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb().prepare("SELECT * FROM icp_profiles ORDER BY id").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const info = getDb()
    .prepare(
      `INSERT INTO icp_profiles (name, description, age_min, age_max, genders, geo, interests, pain_points, tone)
       VALUES (@name, @description, @age_min, @age_max, @genders, @geo, @interests, @pain_points, @tone)`
    )
    .run({
      name: b.name ?? "New ICP",
      description: b.description ?? "",
      age_min: b.age_min ?? 25,
      age_max: b.age_max ?? 55,
      genders: b.genders ?? "all",
      geo: b.geo ?? "US",
      interests: b.interests ?? "",
      pain_points: b.pain_points ?? "",
      tone: b.tone ?? "confident, direct",
    });
  return NextResponse.json({ id: info.lastInsertRowid });
}

export async function PUT(req: NextRequest) {
  const b = await req.json();
  getDb()
    .prepare(
      `UPDATE icp_profiles SET name=@name, description=@description, age_min=@age_min, age_max=@age_max,
       genders=@genders, geo=@geo, interests=@interests, pain_points=@pain_points, tone=@tone WHERE id=@id`
    )
    .run(b);
  return NextResponse.json({ ok: true });
}
