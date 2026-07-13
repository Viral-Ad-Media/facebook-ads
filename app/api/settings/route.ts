import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAllSettings());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    setSetting(key, String(value));
  }
  return NextResponse.json(getAllSettings());
}
