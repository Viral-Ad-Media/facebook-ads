"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Play, Pause, Activity, Bot, CircleDollarSign } from "lucide-react";
import EngineBanner from "@/components/EngineBanner";
import { getJson } from "@/lib/client";

type Campaign = {
  id: number;
  name: string;
  objective: string;
  status: string;
  daily_budget_cents: number;
  icp_name?: string;
  fb_campaign_id?: string;
  ad_sets: {
    id: number;
    name: string;
    ads: {
      id: number;
      name: string;
      status: string;
      engine_managed: number;
      headline?: string;
      totals: {
        impressions: number;
        clicks: number;
        spend_cents: number;
        conversions: number;
        ctr: number;
        frequency: number;
      };
    }[];
  }[];
};

type ActionRow = {
  id: number;
  action: string;
  reason: string;
  ad_name?: string;
  campaign_name?: string;
  executed: number;
  created_at: string;
};

type MetricPoint = { date: string; spend_cents: number; clicks: number; ctr: number; conversions: number };

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-400/10",
  paused: "text-amber-400 bg-amber-400/10",
  launching: "text-sky-400 bg-sky-400/10",
  draft: "text-slate-400 bg-slate-400/10",
  stopped: "text-red-400 bg-red-400/10",
  error: "text-red-400 bg-red-400/10",
};

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [series, setSeries] = useState<MetricPoint[]>([]);

  const load = useCallback(async () => {
    const [c, a, m] = await Promise.all([
      getJson<Campaign[]>("/api/campaigns", []),
      getJson<ActionRow[]>("/api/actions", []),
      getJson<any[]>("/api/metrics", []),
    ]);
    setCampaigns(c);
    setActions(a);
    setSeries(m.map((p: any) => ({ ...p, spend: p.spend_cents / 100 })));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleAd(campaign: Campaign, adId: number, to: "active" | "paused") {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "launch_campaign",
        payload: { campaign_id: campaign.id, set_ad_status: { ad_id: adId, status: to } },
      }),
    });
    load();
  }

  async function toggleCampaign(campaign: Campaign, to: "active" | "paused") {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "launch_campaign",
        payload: { campaign_id: campaign.id, set_campaign_status: { status: to } },
      }),
    });
    load();
  }

  const totalSpend = series.reduce((s, p) => s + p.spend_cents, 0);
  const totalClicks = series.reduce((s, p) => s + p.clicks, 0);
  const totalConv = series.reduce((s, p) => s + p.conversions, 0);

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Campaigns</h1>
      <p className="text-sm text-slate-500 mb-6">
        Live performance from the local database. The engine syncs Facebook insights and acts within
        your guardrails on every <code className="text-accent-soft">/monitor</code> run.
      </p>
      <EngineBanner />

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total spend", value: `$${(totalSpend / 100).toFixed(2)}`, icon: CircleDollarSign },
          { label: "Clicks", value: totalClicks.toLocaleString(), icon: Activity },
          { label: "Conversions", value: totalConv.toLocaleString(), icon: Bot },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <Icon className="w-5 h-5 text-accent" />
            <div>
              <div className="text-lg font-semibold text-white">{value}</div>
              <div className="text-[12px] text-slate-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      {series.length > 1 && (
        <div className="card p-4 mb-6">
          <h2 className="font-medium text-white text-sm mb-3">Daily spend &amp; CTR</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid stroke="#252c3a" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis yAxisId="l" stroke="#64748b" fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "#161b22", border: "1px solid #252c3a", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Line yAxisId="l" type="monotone" dataKey="spend" name="Spend ($)" stroke="#1877f2" strokeWidth={2} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="ctr" name="CTR (%)" stroke="#34d399" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        {/* Campaign cards */}
        <div className="space-y-4">
          {campaigns.length === 0 && (
            <div className="card p-10 text-center text-sm text-slate-500">
              No campaigns yet. Build creatives in the Ad Studio, approve them, and launch.
            </div>
          )}
          {campaigns.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-white text-sm">{c.name}</div>
                  <div className="text-[12px] text-slate-500">
                    {c.objective.replace("OUTCOME_", "").toLowerCase()} · ${(c.daily_budget_cents / 100).toFixed(0)}/day
                    {c.icp_name ? ` · ${c.icp_name}` : ""}
                    {c.fb_campaign_id ? ` · FB ${c.fb_campaign_id}` : " · not on Facebook yet"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STATUS_COLOR[c.status] ?? STATUS_COLOR.draft}`}>
                    {c.status}
                  </span>
                  {c.fb_campaign_id &&
                    (c.status === "active" ? (
                      <button title="Pause entire campaign" className="btn-secondary !py-1 !px-2 text-[11px] flex items-center gap-1"
                        onClick={() => toggleCampaign(c, "paused")}>
                        <Pause className="w-3 h-3" /> Pause campaign
                      </button>
                    ) : c.status === "paused" ? (
                      <button title="Activate entire campaign" className="btn-primary !py-1 !px-2 text-[11px] flex items-center gap-1"
                        onClick={() => toggleCampaign(c, "active")}>
                        <Play className="w-3 h-3" /> Activate campaign
                      </button>
                    ) : null)}
                </div>
              </div>
              {c.ad_sets.flatMap((s) => s.ads).map((ad) => (
                <div key={ad.id} className="flex items-center gap-3 border-t border-line py-2 text-[13px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ad.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className="text-slate-300 truncate flex-1">{ad.headline || ad.name}</span>
                  <span className="text-slate-500 tabular-nums shrink-0">
                    {ad.totals.impressions.toLocaleString()} imp · {ad.totals.clicks} clicks ·{" "}
                    {ad.totals.ctr.toFixed(2)}% CTR · ${(ad.totals.spend_cents / 100).toFixed(2)}
                  </span>
                  {ad.engine_managed ? (
                    <span className="text-[10px] text-accent-soft border border-accent/40 rounded px-1.5 py-0.5 shrink-0">engine</span>
                  ) : null}
                  {ad.status === "active" ? (
                    <button title="Pause ad" className="text-slate-400 hover:text-amber-400"
                      onClick={() => toggleAd(c, ad.id, "paused")}>
                      <Pause className="w-4 h-4" />
                    </button>
                  ) : (
                    <button title="Activate ad" className="text-slate-400 hover:text-emerald-400"
                      onClick={() => toggleAd(c, ad.id, "active")}>
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Engine action log */}
        <div className="card p-4 h-fit">
          <h2 className="font-medium text-white text-sm mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4 text-accent" /> Engine action log
          </h2>
          {actions.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              No actions yet. The engine logs every pause, activation, and budget change here.
            </p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {actions.map((a) => (
                <div key={a.id} className="text-[12px] border-l-2 border-line pl-3">
                  <div className="text-slate-300">
                    <span className="font-medium text-white">{a.action.replace(/_/g, " ")}</span>
                    {a.ad_name ? ` — ${a.ad_name}` : a.campaign_name ? ` — ${a.campaign_name}` : ""}
                    {!a.executed && <span className="text-amber-400"> (proposed)</span>}
                  </div>
                  <div className="text-slate-500">{a.reason}</div>
                  <div className="text-slate-600">{a.created_at}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
