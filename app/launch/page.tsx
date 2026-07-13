"use client";

import { useEffect, useMemo, useState } from "react";
import { Rocket, Target, DollarSign, ShieldCheck } from "lucide-react";
import EngineBanner from "@/components/EngineBanner";
import { OBJECTIVES } from "@/lib/format-specs";
import { recommendSpend } from "@/lib/spend";

type Icp = {
  id: number;
  name: string;
  age_min: number;
  age_max: number;
  genders: string;
  geo: string;
  interests: string;
};
type Creative = {
  id: number;
  headline: string;
  format: string;
  media_type: string;
  asset_path?: string;
  asset_url?: string;
  product?: string;
};

export default function LaunchPage() {
  const [icps, setIcps] = useState<Icp[]>([]);
  const [approved, setApproved] = useState<Creative[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_TRAFFIC");
  const [icpId, setIcpId] = useState(0);
  const [budgetCents, setBudgetCents] = useState(1500);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/icp").then((r) => r.json()),
      fetch("/api/creatives?status=approved").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([i, c, s]) => {
      setIcps(i);
      setApproved(c);
      setSettings(s);
      if (i.length) setIcpId(i[0].id);
    });
  }, []);

  const icp = icps.find((i) => i.id === icpId);
  const rec = useMemo(
    () =>
      recommendSpend({
        objective,
        target_cpa_cents: Number(settings.target_cpa_cents ?? 2500),
        ad_count: selectedIds.length || 1,
      }),
    [objective, settings, selectedIds.length]
  );
  const maxDaily = Number(settings.max_daily_spend_cents ?? 5000);

  useEffect(() => {
    setBudgetCents(Math.min(rec.recommended_daily_cents, maxDaily));
  }, [rec.recommended_daily_cents, maxDaily]);

  async function launch() {
    await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || `${approved.find((c) => selectedIds.includes(c.id))?.product ?? "Campaign"} — ${new Date().toISOString().slice(0, 10)}`,
        objective,
        icp_id: icpId,
        daily_budget_cents: budgetCents,
        creative_ids: selectedIds,
      }),
    });
    setQueued(true);
    setSelectedIds([]);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Launch campaign</h1>
      <p className="text-sm text-slate-500 mb-6">
        Pick approved creatives, confirm targeting and spend, then hand off to the engine. Campaigns
        are created <span className="text-slate-300">paused</span> on Facebook — you activate from
        the dashboard after final review.
      </p>
      <EngineBanner />
      {queued && (
        <div className="card border-emerald-500/40 bg-emerald-500/10 px-4 py-3 mb-6 text-sm text-emerald-200">
          Launch queued. Run <code>/launch</code> in Claude Code to create the campaign on Facebook
          (paused), then activate it from the Campaigns page.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Creative selection */}
        <div className="card p-4">
          <h2 className="font-medium text-white text-sm mb-3">1 · Approved creatives</h2>
          {approved.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing approved yet — approve variants in the Ad Studio first.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {approved.map((c) => {
                const src = c.asset_path
                  ? c.asset_path.startsWith("/") ? c.asset_path : `/${c.asset_path}`
                  : c.asset_url;
                const on = selectedIds.includes(c.id);
                return (
                  <button key={c.id}
                    className={`rounded-lg overflow-hidden border text-left transition-all ${
                      on ? "border-accent ring-2 ring-accent/50" : "border-line hover:border-slate-600"
                    }`}
                    onClick={() =>
                      setSelectedIds((ids) => (on ? ids.filter((i) => i !== c.id) : [...ids, c.id]))
                    }>
                    <div className="aspect-square bg-surface-overlay">
                      {src &&
                        (c.media_type === "video" ? (
                          <video src={src} className="w-full h-full object-cover" muted />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="w-full h-full object-cover" />
                        ))}
                    </div>
                    <div className="p-1.5 text-[11px] text-slate-300 truncate">{c.headline}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Campaign setup */}
          <div className="card p-4">
            <h2 className="font-medium text-white text-sm mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-accent" /> 2 · Objective &amp; audience
            </h2>
            <label className="label">Campaign name</label>
            <input className="input mb-3" value={name} placeholder="Auto-named if blank"
              onChange={(e) => setName(e.target.value)} />
            <label className="label">Objective</label>
            <select className="input mb-3" value={objective} onChange={(e) => setObjective(e.target.value)}>
              {OBJECTIVES.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <label className="label">Ideal customer profile</label>
            <select className="input mb-2" value={icpId} onChange={(e) => setIcpId(Number(e.target.value))}>
              {icps.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            {icp && (
              <div className="text-[12px] text-slate-500 bg-surface rounded-lg p-2.5 border border-line">
                Targets ages {icp.age_min}–{icp.age_max}, {icp.genders === "all" ? "all genders" : icp.genders},{" "}
                {icp.geo} · interests: {icp.interests || "broad"}
              </div>
            )}
          </div>

          {/* Budget */}
          <div className="card p-4">
            <h2 className="font-medium text-white text-sm mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-accent" /> 3 · Daily budget
            </h2>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-semibold text-white">${(budgetCents / 100).toFixed(2)}</span>
              <span className="text-[12px] text-slate-500">per day</span>
            </div>
            <input type="range" className="w-full accent-[#1877f2]"
              min={rec.minimum_daily_cents} max={maxDaily} step={100}
              value={budgetCents} onChange={(e) => setBudgetCents(Number(e.target.value))} />
            <div className="flex justify-between text-[11px] text-slate-600 mb-2">
              <span>min ${(rec.minimum_daily_cents / 100).toFixed(0)}</span>
              <span>guardrail ${(maxDaily / 100).toFixed(0)}</span>
            </div>
            <p className="text-[12px] text-slate-500">
              <span className="text-slate-300">Recommended ${(rec.recommended_daily_cents / 100).toFixed(0)}/day.</span>{" "}
              {rec.rationale}
            </p>
          </div>

          {/* Launch */}
          <div className="card p-4">
            <h2 className="font-medium text-white text-sm mb-2 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> 4 · Review &amp; launch
            </h2>
            <ul className="text-[12px] text-slate-500 space-y-1 mb-4">
              <li>• {selectedIds.length} creative{selectedIds.length === 1 ? "" : "s"} → 1 ad set → {selectedIds.length} ad{selectedIds.length === 1 ? "" : "s"}</li>
              <li>• Created <span className="text-slate-300">PAUSED</span> — no spend until you activate</li>
              <li>• Optimization engine manages it within your guardrails once live</li>
            </ul>
            <button className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={!selectedIds.length} onClick={launch}>
              <Rocket className="w-4 h-4" /> Launch to Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
