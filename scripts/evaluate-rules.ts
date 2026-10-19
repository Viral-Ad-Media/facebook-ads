try {
  process.loadEnvFile(".env.local");
} catch {
  /* shell environment */
}
import { sql, transaction, jsonValue } from "../lib/db";
import { guardrails, safetyLock } from "../lib/safety";
import { accountDate, isoDate } from "../lib/validation";
import { evaluateRules, RuleAd, Daily } from "../lib/rules";
const preview = process.argv.includes("--preview");
async function main() {
  const result = await transaction(async (db) => {
    await safetyLock(db);
    const s = await guardrails(db);
    const today = accountDate(s.account_timezone);
    const since = new Date(
      Date.parse(today) - (Number(s.lookback_days) - 1) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const [sync] =
      await db`SELECT * FROM account_sync WHERE account_id=${s.fb_ad_account_id}`;
    if (
      !sync ||
      isoDate(sync.account_date) !== today ||
      sync.timezone !== s.account_timezone ||
      sync.currency !== s.currency ||
      Date.now() - new Date(sync.synced_at).getTime() >
        Number(s.max_sync_age_minutes) * 60000
    )
      throw new Error(
        "Fresh full-account sync required; no proposals were written",
      );
    const rows =
      await db`SELECT a.*,s.campaign_id,s.daily_budget_cents,s.id ad_set_id,c.objective,p.frequency period_frequency,p.since_date,p.until_date,p.synced_at period_synced FROM ads a JOIN ad_sets s ON s.id=a.ad_set_id JOIN campaigns c ON c.id=s.campaign_id LEFT JOIN metrics_period p ON p.ad_id=a.id WHERE a.status='active' AND c.status='active' AND a.fb_ad_id IS NOT NULL`;
    const metrics = rows.length
      ? await db`SELECT * FROM metrics_daily WHERE ad_id IN ${db(rows.map((a) => a.id))} AND date BETWEEN ${since} AND ${today} ORDER BY date DESC`
      : [];
    const ads: RuleAd[] = rows.map((a) => {
      const days = metrics.filter((m) => m.ad_id === a.id);
      const fresh =
        days.length > 0 &&
        isoDate(days[0].date) === today &&
        days.every(
          (m) =>
            Date.now() - new Date(m.synced_at).getTime() <=
            Number(s.max_sync_age_minutes) * 60000,
        );
      const periodFresh =
        a.period_synced &&
        isoDate(a.since_date) === since &&
        isoDate(a.until_date) === today &&
        Date.now() - new Date(a.period_synced).getTime() <=
          Number(s.max_sync_age_minutes) * 60000;
      return {
        ...a,
        frequency: periodFresh ? a.period_frequency : null,
        fresh,
        days: days.map((m) => ({ ...m, date: isoDate(m.date) }) as Daily),
      } as RuleAd;
    });
    const [total] =
      await db`SELECT COALESCE(SUM(reserved_budget_cents),0)::float8 value FROM campaigns`;
    const recent =
      await db`SELECT ad_set_id FROM engine_actions WHERE action='scale_budget' AND (status='running' OR (executed=1 AND COALESCE(executed_at,created_at)>now()-interval '24 hours'))`;
    // Expire unexecuted recommendations; the engine must fetch fresh proposals.
    if (!preview)
      await db`UPDATE engine_actions SET status='expired' WHERE status='proposed' AND created_at<now()-interval '30 minutes'`;
    const pending =
      await db`SELECT ad_set_id FROM engine_actions WHERE action='scale_budget' AND status IN ('proposed','running')`;
    const proposed = evaluateRules({
      settings: s,
      ads,
      accountSpend: sync.spend_cents,
      reservedBudget: Number(total.value) + sync.external_daily_budget_cents,
      scaledSets: new Set(recent.map((r) => r.ad_set_id)),
      pendingSets: new Set(pending.map((r) => r.ad_set_id)),
    });
    if (preview) return { preview: true, proposed };
    const saved = [];
    for (const a of proposed) {
      const key = `${a.action}:${a.ad_id ?? "account"}:${today}:${a.ad_set_id ?? 0}`;
      const [row] =
        await db`INSERT INTO engine_actions(ad_id,campaign_id,ad_set_id,action,reason,metrics_snapshot,executed,proposal_key) VALUES(${a.ad_id},${a.campaign_id},${a.ad_set_id},${a.action},${a.reason},${db.json(jsonValue({ ...a.metrics_snapshot, params: a.params ?? null }))},0,${key}) ON CONFLICT(proposal_key) WHERE proposal_key IS NOT NULL DO UPDATE SET metrics_snapshot=excluded.metrics_snapshot,reason=excluded.reason,created_at=now(),status='proposed' WHERE engine_actions.status='expired' RETURNING id`;
      if (row) saved.push({ engine_action_id: row.id, ...a });
    }
    return { proposed: saved };
  });
  console.log(JSON.stringify(result, null, 2));
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
