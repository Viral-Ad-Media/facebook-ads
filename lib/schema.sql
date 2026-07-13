-- Facebook Ads Studio — local performance database

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS icp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  age_min INTEGER DEFAULT 25,
  age_max INTEGER DEFAULT 55,
  genders TEXT DEFAULT 'all',              -- all | male | female
  geo TEXT DEFAULT 'US',                   -- comma-separated country codes
  interests TEXT,                          -- comma-separated interest keywords
  pain_points TEXT,
  tone TEXT DEFAULT 'confident, direct',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icp_id INTEGER REFERENCES icp_profiles(id),
  product TEXT NOT NULL,
  offer TEXT,
  angle TEXT,                              -- creative angle / hook direction
  landing_url TEXT,
  formats TEXT NOT NULL DEFAULT 'feed_square,story_vertical', -- see lib/format-specs.ts
  media_types TEXT NOT NULL DEFAULT 'image', -- image,video
  variant_count INTEGER DEFAULT 2,
  notes TEXT,
  status TEXT DEFAULT 'draft',             -- draft | generating | ready
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id INTEGER REFERENCES briefs(id),
  media_type TEXT NOT NULL,                -- image | video
  format TEXT NOT NULL,                    -- feed_square | feed_portrait | story_vertical | landscape
  asset_path TEXT,                         -- local path under public/
  asset_url TEXT,                          -- hosted URL (Higgsfield CDN)
  fb_image_hash TEXT,
  fb_video_id TEXT,
  primary_text TEXT,
  headline TEXT,
  description TEXT,
  cta TEXT DEFAULT 'LEARN_MORE',
  hook TEXT,                               -- the hook/angle used, for learnings
  status TEXT DEFAULT 'generated',         -- generated | approved | launched | archived
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_campaign_id TEXT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'OUTCOME_TRAFFIC',
  status TEXT DEFAULT 'draft',             -- draft | launching | paused | active | stopped | error
  daily_budget_cents INTEGER,
  icp_id INTEGER REFERENCES icp_profiles(id),
  launched_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES campaigns(id),
  fb_adset_id TEXT,
  name TEXT NOT NULL,
  targeting_json TEXT,                     -- FB targeting spec as sent
  daily_budget_cents INTEGER,
  optimization_goal TEXT DEFAULT 'LINK_CLICKS',
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_set_id INTEGER REFERENCES ad_sets(id),
  creative_id INTEGER REFERENCES creatives(id),
  fb_ad_id TEXT,
  fb_creative_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft',             -- draft | paused | active | stopped | error
  engine_managed INTEGER DEFAULT 1,        -- 1 = optimization engine may act on this ad
  fb_preview_html TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER REFERENCES ads(id),
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  frequency REAL DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr REAL DEFAULT 0,                      -- percent
  cpc_cents INTEGER DEFAULT 0,
  cpm_cents INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cpa_cents INTEGER DEFAULT 0,
  roas REAL DEFAULT 0,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(ad_id, date)
);

CREATE TABLE IF NOT EXISTS engine_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER REFERENCES ads(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  action TEXT NOT NULL,                    -- pause | activate | scale_budget | flag | kill_switch | regenerate_queued
  reason TEXT NOT NULL,
  metrics_snapshot TEXT,                   -- JSON of the metrics that triggered it
  executed INTEGER DEFAULT 0,              -- 0 proposed, 1 executed on Facebook
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension TEXT NOT NULL,                 -- hook | format | audience | offer | media_type
  insight TEXT NOT NULL,
  evidence TEXT,                           -- supporting numbers, JSON or text
  confidence REAL DEFAULT 0.5,             -- 0..1
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitor_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,                     -- brand/keyword searched
  page_name TEXT,
  library_id TEXT,                         -- Meta Ads Library ad id
  body TEXT,
  headline TEXT,
  cta TEXT,
  media_type TEXT,                         -- image | video | carousel | unknown
  media_url TEXT,
  snapshot_url TEXT,                       -- link into the Ads Library
  started_at TEXT,                         -- delivery start date — longevity = winning signal
  platforms TEXT,                          -- facebook,instagram,…
  analysis TEXT,                           -- engine's note on why it works (hook, angle, offer)
  starred INTEGER DEFAULT 0,
  collected_at TEXT DEFAULT (datetime('now')),
  UNIQUE(library_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                      -- generate_creative | launch_campaign | sync_metrics | regenerate
  payload TEXT NOT NULL DEFAULT '{}',      -- JSON
  status TEXT DEFAULT 'pending',           -- pending | running | done | failed
  result TEXT,                             -- JSON or error message
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_ad_date ON metrics_daily(ad_id, date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_actions_created ON engine_actions(created_at);
