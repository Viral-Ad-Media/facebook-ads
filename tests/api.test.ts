import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { NextRequest } from "next/server";
import {
  POST as createCampaign,
  GET as campaigns,
} from "../app/api/campaigns/route";
import { POST as createBrief } from "../app/api/briefs/route";
import { PATCH as editCreative } from "../app/api/creatives/route";
import { POST as engine } from "../app/api/engine/route";
import { POST as login } from "../app/api/login/route";
import { POST as logout } from "../app/api/logout/route";
import { PUT as settings } from "../app/api/settings/route";
import { proxy } from "../proxy";
import { accountDate } from "../lib/validation";
const request = (
  path: string,
  value: unknown,
  method = "POST",
  headers: Record<string, string> = {},
) =>
  new NextRequest(`http://localhost:3100${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      ...headers,
    },
    body: JSON.stringify(value),
  });
test("API transactions, preflight, sessions and authorization work with a migrated Postgres database", async () => {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  let client: ReturnType<typeof postgres> | undefined;
  try {
    for (const file of [
      "001_schema.sql",
      "002_safety.sql",
      "003_privileges.sql",
    ])
      await db.exec(await readFile(`migrations/${file}`, "utf8"));
    await server.start();
    client = postgres(
      `postgres://postgres@${server.getServerConn()}/postgres`,
      {
        ssl: false,
        prepare: false,
        max: 1,
        connection: { search_path: "fbads" },
        onnotice: () => {},
      },
    );
    globalThis.__fbadsSql = client;
    await client`INSERT INTO icp_profiles(name) VALUES('Test audience')`;
    const brief = {
      product: "Product",
      landing_url: "https://example.com",
      icp_id: 1,
    };
    const key = randomUUID();
    const first = await createBrief(
      request("/api/briefs", brief, "POST", { "idempotency-key": key }),
    );
    assert.equal(first.status, 201);
    const replay = await createBrief(
      request("/api/briefs", brief, "POST", { "idempotency-key": key }),
    );
    assert.deepEqual(await replay.json(), await first.json());
    assert.equal((await client`SELECT COUNT(*)::int n FROM briefs`)[0].n, 1);
    assert.equal((await client`SELECT COUNT(*)::int n FROM jobs`)[0].n, 1);
    const conflict = await createBrief(
      request("/api/briefs", { ...brief, product: "Other" }, "POST", {
        "idempotency-key": key,
      }),
    );
    assert.equal(conflict.status, 409);
    // Force queue insertion to fail and verify both the draft and request row roll back.
    await client.unsafe(
      `CREATE FUNCTION fbads.reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test enqueue failure'; END $$; CREATE TRIGGER reject_test_job BEFORE INSERT ON fbads.jobs FOR EACH ROW EXECUTE FUNCTION fbads.reject_test_job();`,
    );
    assert.equal(
      (
        await createBrief(
          request("/api/briefs", { ...brief, product: "Rollback" }),
        )
      ).status,
      503,
    );
    assert.equal((await client`SELECT COUNT(*)::int n FROM briefs`)[0].n, 1);
    await client.unsafe("DROP TRIGGER reject_test_job ON fbads.jobs");
    await client`INSERT INTO creatives(brief_id,media_type,format,asset_url,primary_text,headline,cta) VALUES(1,'image','feed_square','https://example.com/a.png','Hello','Title','LEARN_MORE')`;
    assert.equal(
      (
        await editCreative(
          request(
            "/api/creatives",
            { id: 1, version: 0, status: "approved" },
            "PATCH",
          ),
        )
      ).status,
      200,
    );
    const campaign = {
      name: "Campaign",
      objective: "OUTCOME_TRAFFIC",
      daily_budget_cents: 3000,
      icp_id: 1,
      creative_ids: [1],
    };
    const launch = await createCampaign(request("/api/campaigns", campaign));
    assert.equal(launch.status, 201);
    assert.equal(
      (await createCampaign(request("/api/campaigns", campaign))).status,
      400,
    );
    const change = await editCreative(
      request(
        "/api/creatives",
        { id: 1, version: 0, headline: "Edited" },
        "PATCH",
      ),
    );
    assert.equal(change.status, 200);
    assert.equal(
      (
        await editCreative(
          request(
            "/api/creatives",
            { id: 1, version: 0, headline: "Stale" },
            "PATCH",
          ),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await createCampaign(
          request("/api/campaigns", { ...campaign, daily_budget_cents: 1000 }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await settings(
          request("/api/settings", { max_daily_spend_cents: "1000" }, "PUT"),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await client`SELECT value FROM settings WHERE key='max_daily_spend_cents'`
      ).length,
      0,
    );
    process.env.ENGINE_TOKEN = "test-engine-token-with-at-least-32-characters";
    const authorization = `Bearer ${process.env.ENGINE_TOKEN}`;
    const worker = randomUUID();
    const call = (b: unknown) =>
      engine(request("/api/engine", b, "POST", { authorization }));
    assert.equal(
      (
        await engine(
          request("/api/engine", {
            command: "claim",
            worker,
            types: ["launch_campaign"],
          }),
        )
      ).status,
      401,
    );
    const claimed = await call({
      command: "claim",
      worker,
      types: ["launch_campaign"],
    });
    assert.equal(claimed.status, 200);
    const { job } = await claimed.json();
    assert.equal(
      (
        await call({
          command: "job_operation",
          worker,
          job_id: job.id,
          step: "campaign:create",
        })
      ).status,
      400,
    ); // queued approval was invalidated
    // Checkpoint a generation slot and prove it cannot be billed twice.
    const generation = await (
      await call({ command: "claim", worker, types: ["generate_creative"] })
    ).json();
    const start = await call({
      command: "job_operation",
      worker,
      job_id: generation.job.id,
      step: "generation:1:generate",
    });
    assert.equal(start.status, 200);
    const operation = await start.json();
    assert.equal(
      (
        await call({
          command: "job_operation",
          worker,
          job_id: generation.job.id,
          step: "generation:1:generate",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call({
          command: "finish_operation",
          worker,
          key: operation.key,
          result: { task_id: "provider-task-1" },
        })
      ).status,
      200,
    );
    const recovered = await (
      await call({
        command: "job_operation",
        worker,
        job_id: generation.job.id,
        step: "generation:1:generate",
      })
    ).json();
    assert.equal(recovered.already_done, true);
    assert.equal(recovered.result.task_id, "provider-task-1");
    assert.equal(
      (await call({ command: "heartbeat", worker, job_id: generation.job.id }))
        .status,
      200,
    );
    assert.equal(
      (
        await call({
          command: "finish_job",
          worker,
          job_id: generation.job.id,
          result: { creative_ids: [1] },
        })
      ).status,
      200,
    );
    // Scaling reserves aggregate headroom and cooldown is shared by every ad in the set.
    await client`INSERT INTO settings(key,value) VALUES('fb_ad_account_id','act_123')`;
    await client`UPDATE campaigns SET status='active',fb_campaign_id='meta-1' WHERE id=1`;
    await client`INSERT INTO ad_sets(campaign_id,daily_budget_cents) VALUES(1,3000)`;
    await client`INSERT INTO ads(ad_set_id,creative_id,fb_ad_id,status) VALUES(1,1,'meta-ad-1','active')`;
    assert.equal(
      (
        await call({
          command: "sync_account",
          account_id: "act_123",
          account_date: accountDate("America/Chicago"),
          timezone: "America/Chicago",
          currency: "USD",
          spend_cents: 100,
          external_daily_budget_cents: 0,
        })
      ).status,
      200,
    );
    const params = {
      params: { current_budget_cents: 3000, new_budget_cents: 3600 },
    };
    const [action] =
      await client`INSERT INTO engine_actions(ad_id,campaign_id,ad_set_id,action,reason,metrics_snapshot,proposal_key) VALUES(1,1,1,'scale_budget','Scale',${client.json(params)},'test-scale') RETURNING id`;
    const scale = await call({
      command: "action_operation",
      worker,
      action_id: action.id,
    });
    assert.equal(scale.status, 200);
    assert.equal(
      (await client`SELECT reserved_budget_cents FROM campaigns WHERE id=1`)[0]
        .reserved_budget_cents,
      3600,
    );
    assert.equal(
      (
        await call({
          command: "action_operation",
          worker,
          action_id: action.id,
        })
      ).status,
      409,
    );
    await call({
      command: "finish_operation",
      worker,
      key: `action:${action.id}`,
      result: { updated: true },
    });
    assert.equal(
      (
        await call({
          command: "finish_action",
          worker,
          action_id: action.id,
          result: { updated: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (await client`SELECT daily_budget_cents FROM ad_sets WHERE id=1`)[0]
        .daily_budget_cents,
      3600,
    );
    const [secondAction] =
      await client`INSERT INTO engine_actions(ad_id,campaign_id,ad_set_id,action,reason,metrics_snapshot,proposal_key) VALUES(1,1,1,'scale_budget','Scale',${client.json({ params: { current_budget_cents: 3600, new_budget_cents: 4320 } })},'test-scale-second') RETURNING id`;
    assert.equal(
      (
        await call({
          command: "action_operation",
          worker,
          action_id: secondAction.id,
        })
      ).status,
      409,
    );
    const list = await campaigns(
      new NextRequest("http://localhost:3100/api/campaigns?limit=20&offset=0"),
    );
    assert.equal(list.status, 200);
    assert.equal((await list.json()).length, 1);
    process.env.ADMIN_PASSWORD = "integration-test-strong-password";
    assert.equal(
      (await proxy(new NextRequest("http://localhost:3100/api/jobs"))).status,
      401,
    );
    assert.equal(
      (await login(request("/api/login", { password: "wrong" }))).status,
      401,
    );
    const signed = await login(
      request("/api/login", { password: process.env.ADMIN_PASSWORD }),
    );
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get("set-cookie")!.split(";")[0];
    assert.match(cookie, /ads_session=[a-f0-9]{64}$/);
    const authorized = new NextRequest("http://localhost:3100/api/jobs", {
      headers: { cookie },
    });
    assert.equal((await proxy(authorized)).status, 200);
    assert.equal(
      (
        await proxy(
          request("/api/settings", {}, "PUT", {
            cookie,
            origin: "https://attacker.example",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (await logout(request("/api/logout", {}, "POST", { cookie }))).status,
      200,
    );
    assert.equal((await proxy(authorized)).status, 401);
    process.env.ADMIN_USERS_JSON = JSON.stringify({
      reader: { password: "viewer-account-strong-password", role: "viewer" },
    });
    const viewerLogin = await login(
      request("/api/login", {
        username: "reader",
        password: "viewer-account-strong-password",
      }),
    );
    assert.equal(viewerLogin.status, 200);
    const viewerCookie = viewerLogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await proxy(
          new NextRequest("http://localhost:3100/api/settings", {
            headers: { cookie: viewerCookie },
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await proxy(
          request("/api/settings", {}, "PUT", { cookie: viewerCookie }),
        )
      ).status,
      403,
    );
    process.env.ADMIN_USERS_JSON = JSON.stringify({
      reader: { password: "rotated-viewer-account-password", role: "viewer" },
    });
    assert.equal(
      (
        await proxy(
          new NextRequest("http://localhost:3100/api/settings", {
            headers: { cookie: viewerCookie },
          }),
        )
      ).status,
      401,
    );
    delete process.env.ADMIN_USERS_JSON;
    for (let i = 0; i < 31; i++)
      await login(request("/api/login", { password: "wrong" }));
    assert.equal(
      (await login(request("/api/login", { password: "wrong" }))).status,
      429,
    );
  } finally {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_USERS_JSON;
    delete process.env.ENGINE_TOKEN;
    if (client) await client.end();
    globalThis.__fbadsSql = undefined;
    await server.stop();
    await db.close();
  }
});
