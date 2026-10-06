import { NextResponse } from "next/server";
import { getAllSettings, transaction } from "@/lib/db";
import { api, body } from "@/lib/http";
import { settingsSchema, settingsPatchSchema } from "@/lib/validation";
import { safetyLock, allowance } from "@/lib/safety";
export const dynamic = "force-dynamic";
export const GET = api(async () => NextResponse.json(await getAllSettings()));
export const PUT = api(async (req) => {
  const patch = await body(req, settingsPatchSchema);
  return NextResponse.json(
    await transaction(async (db) => {
      await safetyLock(db);
      const next = settingsSchema.parse({
        ...(await getAllSettings(db)),
        ...patch,
      });
      for (const [key, value] of Object.entries(next))
        await db`INSERT INTO settings(key,value) VALUES(${key},${value}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      await allowance(db, 0);
      return next;
    }),
  );
});
