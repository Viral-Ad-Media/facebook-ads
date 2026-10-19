import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migrations create a usable database, safe claims, version guards and proposal constraints", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "001_schema.sql",
      "002_safety.sql",
      "003_privileges.sql",
    ])
      await db.exec(await readFile(`migrations/${file}`, "utf8"));
    await db.exec(
      `SET search_path=fbads; INSERT INTO icp_profiles(name) VALUES('Audience'); INSERT INTO briefs(icp_id,product,landing_url) VALUES(1,'Product','https://example.com'); INSERT INTO creatives(brief_id,media_type,format,asset_url,primary_text,headline) VALUES(1,'image','feed_square','https://example.com/a.png','Hello','Title');`,
    );
    await db.exec(`UPDATE creatives SET status='approved' WHERE id=1`);
    let c = (
      await db.query<{
        version: number;
        approved_version: number | null;
        status: string;
      }>(`SELECT version,approved_version,status FROM creatives WHERE id=1`)
    ).rows[0];
    assert.equal(c.approved_version, 0);
    await db.exec(`UPDATE creatives SET headline='Changed' WHERE id=1`);
    c = (
      await db.query<typeof c>(
        `SELECT version,approved_version,status FROM creatives WHERE id=1`,
      )
    ).rows[0];
    assert.equal(c.version, 1);
    assert.equal(c.status, "generated");
    assert.equal(c.approved_version, null);
    await db.exec(`UPDATE creatives SET asset_url=NULL WHERE id=1`);
    await assert.rejects(() =>
      db.exec(`UPDATE creatives SET status='approved' WHERE id=1`),
    );
    await db.exec(
      `INSERT INTO jobs(type,payload,idempotency_key) VALUES('launch_campaign','{}','unique-key')`,
    );
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO jobs(type,payload,idempotency_key) VALUES('launch_campaign','{}','unique-key')`,
      ),
    );
    const claimed = (
      await db.query<{ id: number }>(
        `SELECT * FROM claim_job('worker-111111111111',ARRAY['launch_campaign'])`,
      )
    ).rows;
    assert.equal(claimed.length, 1);
    assert.equal(
      (
        await db.query(
          `SELECT * FROM claim_job('worker-222222222222',ARRAY['launch_campaign'])`,
        )
      ).rows.length,
      0,
    );
    await db.exec(
      `UPDATE jobs SET lease_until=now()-interval '1 minute' WHERE id=1`,
    );
    assert.equal(
      (
        await db.query(
          `SELECT * FROM claim_job('worker-222222222222',ARRAY['launch_campaign'])`,
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query<{ status: string }>(`SELECT status FROM jobs WHERE id=1`))
        .rows[0].status,
      "needs_review",
    );
    await db.exec(
      `INSERT INTO campaigns(name,daily_budget_cents) VALUES('Campaign',1500); INSERT INTO ad_sets(campaign_id,daily_budget_cents) VALUES(1,1500); INSERT INTO engine_actions(action,ad_set_id,reason,proposal_key) VALUES('scale_budget',1,'Scale','p1')`,
    );
    await assert.rejects(() =>
      db.exec(
        `INSERT INTO engine_actions(action,ad_set_id,reason,proposal_key) VALUES('scale_budget',1,'Scale','p2')`,
      ),
    );
    // Each DDL migration can also be replayed safely by the migration runner's transaction.
    await db.exec(await readFile("migrations/001_schema.sql", "utf8"));
  } finally {
    await db.close();
  }
});
