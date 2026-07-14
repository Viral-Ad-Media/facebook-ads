import postgres from "postgres";

// Hosted Postgres (Supabase, isolated `fbads` schema). The fbads_app role's
// search_path is set to fbads, so table names stay unqualified here.
// int8 → Number so ids and counts behave like plain JS numbers in JSON.

declare global {
  // eslint-disable-next-line no-var
  var __fbadsSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    ssl: "require",
    prepare: false, // required for Supabase transaction pooler
    max: 5,
    types: {
      bigint: {
        to: 20,
        from: [20],
        parse: (x: string) => Number(x),
        serialize: (x: number | bigint) => String(x),
      },
    },
  });
}

export const sql = globalThis.__fbadsSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__fbadsSql = sql;

export const DEFAULT_SETTINGS: Record<string, string> = {
  fb_ad_account_id: "",
  fb_page_id: "",
  currency: "USD",
  // Guardrails for the optimization engine
  max_daily_spend_cents: "5000", // $50/day account-wide kill switch
  min_impressions_before_action: "1000",
  min_spend_cents_before_action: "1000", // $10
  target_cpa_cents: "2500", // $25
  target_roas: "2",
  ctr_floor: "0.6", // percent
  scale_step_pct: "20",
  fatigue_frequency: "3",
};

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await sql<{ key: string; value: string }[]>`SELECT key, value FROM settings`;
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(key: string, value: string) {
  await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}
