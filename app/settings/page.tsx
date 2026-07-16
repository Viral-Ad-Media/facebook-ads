"use client";

import { useEffect, useState } from "react";
import { Save, Plus, ShieldAlert } from "lucide-react";
import { getJson } from "@/lib/client";

type Icp = {
  id: number;
  name: string;
  description: string;
  age_min: number;
  age_max: number;
  genders: string;
  geo: string;
  interests: string;
  pain_points: string;
  tone: string;
};

const GUARDRAILS: { key: string; label: string; hint: string; dollars?: boolean }[] = [
  { key: "max_daily_spend_cents", label: "Max daily spend (kill switch)", hint: "Engine pauses everything if account spend exceeds this", dollars: true },
  { key: "min_impressions_before_action", label: "Min impressions before action", hint: "Engine won't judge an ad with less data" },
  { key: "min_spend_cents_before_action", label: "Min spend before action", hint: "Second data threshold", dollars: true },
  { key: "target_cpa_cents", label: "Target CPA", hint: "Cost per acquisition goal", dollars: true },
  { key: "target_roas", label: "Target ROAS", hint: "Return on ad spend goal (e.g. 2 = 2x)" },
  { key: "ctr_floor", label: "CTR floor (%)", hint: "Ads below this get paused after the data threshold" },
  { key: "scale_step_pct", label: "Scale step (%)", hint: "Budget increase for winners, max once/24h" },
  { key: "fatigue_frequency", label: "Fatigue frequency", hint: "Avg frequency above this = creative fatigue" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [icps, setIcps] = useState<Icp[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getJson<Record<string, string>>("/api/settings", {}).then(setSettings);
    getJson<Icp[]>("/api/icp", []).then(setIcps);
  }, []);

  async function saveSettings() {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveIcp(icp: Icp) {
    await fetch("/api/icp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(icp),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function addIcp() {
    await fetch("/api/icp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New ICP" }),
    });
    setIcps(await getJson<Icp[]>("/api/icp", []));
  }

  function setIcpField(id: number, field: keyof Icp, value: string | number) {
    setIcps((list) => list.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  const dollars = (cents: string) => (Number(cents || 0) / 100).toString();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Settings</h1>
          <p className="text-sm text-slate-500">
            Facebook account, engine guardrails, and ideal customer profiles.
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={saveSettings}>
          <Save className="w-4 h-4" /> {saved ? "Saved!" : "Save settings"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="card p-4">
            <h2 className="font-medium text-white text-sm mb-3">Facebook account</h2>
            <label className="label">Ad account ID</label>
            <input className="input mb-1" value={settings.fb_ad_account_id ?? ""}
              placeholder="act_1234567890 (leave blank — the engine can auto-detect)"
              onChange={(e) => setSettings({ ...settings, fb_ad_account_id: e.target.value })} />
            <p className="text-[11px] text-slate-600 mb-3">Filled automatically on first /launch if blank.</p>
            <label className="label">Facebook Page ID</label>
            <input className="input" value={settings.fb_page_id ?? ""} placeholder="Page that ads run from"
              onChange={(e) => setSettings({ ...settings, fb_page_id: e.target.value })} />
          </div>

          <div className="card p-4">
            <h2 className="font-medium text-white text-sm mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Engine guardrails
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {GUARDRAILS.map((g) => (
                <div key={g.key}>
                  <label className="label">{g.label}</label>
                  <div className="relative">
                    {g.dollars && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                    )}
                    <input
                      className={`input ${g.dollars ? "pl-7" : ""}`}
                      type="number"
                      step="any"
                      value={g.dollars ? dollars(settings[g.key] ?? "0") : settings[g.key] ?? ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          [g.key]: g.dollars
                            ? String(Math.round(Number(e.target.value || 0) * 100))
                            : e.target.value,
                        })
                      }
                    />
                  </div>
                  <p className="text-[10px] text-slate-600 mt-0.5">{g.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-4 h-fit">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-white text-sm">Ideal customer profiles</h2>
            <button className="btn-secondary !py-1 !px-2.5 text-[12px] flex items-center gap-1" onClick={addIcp}>
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          <div className="space-y-4">
            {icps.map((icp) => (
              <div key={icp.id} className="border border-line rounded-lg p-3 space-y-2.5">
                <input className="input font-medium" value={icp.name}
                  onChange={(e) => setIcpField(icp.id, "name", e.target.value)} />
                <textarea className="input" rows={2} value={icp.description ?? ""} placeholder="Who they are"
                  onChange={(e) => setIcpField(icp.id, "description", e.target.value)} />
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="label">Age min</label>
                    <input className="input" type="number" value={icp.age_min}
                      onChange={(e) => setIcpField(icp.id, "age_min", Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label">Age max</label>
                    <input className="input" type="number" value={icp.age_max}
                      onChange={(e) => setIcpField(icp.id, "age_max", Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="label">Genders</label>
                    <select className="input" value={icp.genders}
                      onChange={(e) => setIcpField(icp.id, "genders", e.target.value)}>
                      <option value="all">All</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Geo</label>
                    <input className="input" value={icp.geo}
                      onChange={(e) => setIcpField(icp.id, "geo", e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Interests (comma separated)</label>
                  <input className="input" value={icp.interests ?? ""}
                    onChange={(e) => setIcpField(icp.id, "interests", e.target.value)} />
                </div>
                <div>
                  <label className="label">Pain points</label>
                  <input className="input" value={icp.pain_points ?? ""}
                    onChange={(e) => setIcpField(icp.id, "pain_points", e.target.value)} />
                </div>
                <div>
                  <label className="label">Copy tone</label>
                  <input className="input" value={icp.tone ?? ""}
                    onChange={(e) => setIcpField(icp.id, "tone", e.target.value)} />
                </div>
                <button className="btn-secondary w-full !py-1.5 text-[12px]" onClick={() => saveIcp(icp)}>
                  Save ICP
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
