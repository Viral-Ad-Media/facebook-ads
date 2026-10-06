SET search_path TO fbads;
ALTER TABLE jobs ALTER COLUMN payload DROP DEFAULT;
ALTER TABLE jobs ALTER COLUMN payload TYPE jsonb USING payload::jsonb;
ALTER TABLE jobs ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE jobs ALTER COLUMN result TYPE jsonb USING result::jsonb;
ALTER TABLE engine_actions ALTER COLUMN metrics_snapshot DROP DEFAULT;
ALTER TABLE engine_actions ALTER COLUMN metrics_snapshot TYPE jsonb USING metrics_snapshot::jsonb;
ALTER TABLE engine_actions ALTER COLUMN metrics_snapshot SET DEFAULT '{}'::jsonb;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS approved_version integer;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '{}';
ALTER TABLE engine_actions ADD COLUMN IF NOT EXISTS ad_set_id integer REFERENCES ad_sets(id);
ALTER TABLE engine_actions ADD COLUMN IF NOT EXISTS proposal_key text;
ALTER TABLE engine_actions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'proposed';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reserved_budget_cents integer NOT NULL DEFAULT 0;
-- Preserve existing allocations conservatively until an operator reconciles them.
UPDATE campaigns c SET reserved_budget_cents = GREATEST(c.daily_budget_cents, COALESCE((SELECT SUM(s.daily_budget_cents) FROM ad_sets s WHERE s.campaign_id=c.id),0)) WHERE c.status IN ('active','paused','launching');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS actions_proposal_key ON engine_actions(proposal_key) WHERE proposal_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS actions_one_pending_scale ON engine_actions(ad_set_id) WHERE action='scale_budget' AND status IN ('proposed','running');
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,type,id);
CREATE INDEX IF NOT EXISTS metrics_ad_date ON metrics_daily(ad_id,date);
CREATE INDEX IF NOT EXISTS ads_adset ON ads(ad_set_id);
CREATE INDEX IF NOT EXISTS adsets_campaign ON ad_sets(campaign_id);
CREATE INDEX IF NOT EXISTS creatives_brief ON creatives(brief_id,id);
CREATE INDEX IF NOT EXISTS competitor_query ON competitor_ads(query,collected_at);
CREATE TABLE IF NOT EXISTS requests (key text PRIMARY KEY, route text NOT NULL, body_hash text NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, secret_version text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS account_sync (account_id text PRIMARY KEY, account_date date NOT NULL, timezone text NOT NULL, currency text NOT NULL, spend_cents integer NOT NULL CHECK(spend_cents>=0), external_daily_budget_cents integer NOT NULL CHECK(external_daily_budget_cents>=0), synced_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS operations (key text PRIMARY KEY, job_id integer REFERENCES jobs(id), action_id integer REFERENCES engine_actions(id), status text NOT NULL DEFAULT 'in_flight' CHECK(status IN ('in_flight','done','needs_review')), owner text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
-- A second engine must never silently retry external side effects after a lease expires.
CREATE OR REPLACE FUNCTION claim_job(worker text, kinds text[]) RETURNS SETOF jobs LANGUAGE plpgsql SET search_path=fbads,pg_temp AS $$
BEGIN
  UPDATE jobs SET status='needs_review', claimed_by=NULL, lease_until=NULL
    WHERE status='running' AND lease_until < now();
  RETURN QUERY WITH candidate AS (
    SELECT id FROM jobs WHERE status='pending' AND type=ANY(kinds) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE jobs j SET status='running', claimed_by=worker, lease_until=now()+interval '10 minutes', attempts=attempts+1
    FROM candidate c WHERE j.id=c.id RETURNING j.*;
END $$;
-- New writes, including engine SQL, invalidate approvals whenever creative content changes.
CREATE OR REPLACE FUNCTION creative_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.primary_text,NEW.headline,NEW.description,NEW.cta,NEW.hook,NEW.asset_url,NEW.asset_path,NEW.media_type,NEW.format) IS DISTINCT FROM ROW(OLD.primary_text,OLD.headline,OLD.description,OLD.cta,OLD.hook,OLD.asset_url,OLD.asset_path,OLD.media_type,OLD.format) THEN
  NEW.version=OLD.version+1; NEW.approved_version=NULL; NEW.status='generated';
 END IF;
 IF NEW.status='approved' THEN
  IF NEW.primary_text IS NULL OR length(trim(NEW.primary_text))=0 OR length(NEW.primary_text)>125 OR NEW.headline IS NULL OR length(trim(NEW.headline))=0 OR length(NEW.headline)>40 OR COALESCE(length(NEW.description),0)>30 OR NEW.asset_url IS NULL OR NEW.asset_url !~ '^https://' THEN RAISE EXCEPTION 'Creative requires valid copy and hosted media'; END IF;
  NEW.approved_version=NEW.version;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS creative_version_guard ON creatives;
CREATE TRIGGER creative_version_guard BEFORE UPDATE ON creatives FOR EACH ROW EXECUTE FUNCTION creative_version_guard();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT 'admin';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'operator';
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS metrics_period (ad_id integer PRIMARY KEY REFERENCES ads(id), since_date date NOT NULL, until_date date NOT NULL, frequency double precision NOT NULL CHECK(frequency>=0), synced_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE engine_actions ADD COLUMN IF NOT EXISTS executed_at timestamptz;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS generation_key text;
CREATE UNIQUE INDEX IF NOT EXISTS creatives_generation ON creatives(generation_key) WHERE generation_key IS NOT NULL;
