import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "ads.db");

let db: Database.Database | null = null;

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

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  seed(db);
  return db;
}

function seed(db: Database.Database) {
  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }
  const icpCount = db.prepare("SELECT COUNT(*) as c FROM icp_profiles").get() as { c: number };
  if (icpCount.c === 0) {
    db.prepare(
      `INSERT INTO icp_profiles (name, description, age_min, age_max, genders, geo, interests, pain_points, tone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "Default ICP",
      "Edit me in Settings — your ideal customer profile",
      25, 54, "all", "US",
      "online shopping, small business",
      "not enough time, wants better results",
      "confident, direct, benefit-led"
    );
  }
}

export function getSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
