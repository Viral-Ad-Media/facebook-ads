"use client";

import { useCallback, useEffect, useState } from "react";
import { Wand2, RefreshCw, CheckCircle2, Lightbulb } from "lucide-react";
import AdPreview from "@/components/AdPreview";
import EngineBanner from "@/components/EngineBanner";
import CharCounter from "@/components/CharCounter";
import { COPY_LIMITS, CTA_OPTIONS, FORMAT_SPECS } from "@/lib/format-specs";

type Icp = { id: number; name: string };
type Learning = { id: number; dimension: string; insight: string; confidence: number };
type Brief = {
  id: number;
  product: string;
  status: string;
  icp_name?: string;
  creative_count: number;
  created_at: string;
};
type Creative = {
  id: number;
  brief_id: number;
  media_type: string;
  format: string;
  asset_path?: string;
  asset_url?: string;
  primary_text: string;
  headline: string;
  description: string;
  cta: string;
  hook?: string;
  status: string;
  product?: string;
  landing_url?: string;
};

export default function StudioPage() {
  const [icps, setIcps] = useState<Icp[]>([]);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<number | null>(null);
  const [selected, setSelected] = useState<Creative | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    product: "",
    offer: "",
    angle: "",
    landing_url: "",
    icp_id: 0,
    formats: ["feed_square", "story_vertical"] as string[],
    media_types: ["image"] as string[],
    variant_count: 2,
    notes: "",
  });

  const load = useCallback(async () => {
    const [i, l, b] = await Promise.all([
      fetch("/api/icp").then((r) => r.json()),
      fetch("/api/learnings").then((r) => r.json()),
      fetch("/api/briefs").then((r) => r.json()),
    ]);
    setIcps(i);
    setLearnings(l.slice(0, 3));
    setBriefs(b);
    if (i.length && !form.icp_id) setForm((f) => ({ ...f, icp_id: i[0].id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCreatives = useCallback(async (briefId: number | null) => {
    const url = briefId ? `/api/creatives?brief_id=${briefId}` : "/api/creatives";
    const rows: Creative[] = await fetch(url).then((r) => r.json());
    setCreatives(rows);
    setSelected((prev) => rows.find((c) => c.id === prev?.id) ?? rows[0] ?? null);
  }, []);

  useEffect(() => {
    load();
    // Prefill from "Use as inspiration" on the Competitors page
    const inspo = sessionStorage.getItem("inspiration");
    if (inspo) {
      sessionStorage.removeItem("inspiration");
      try {
        const { angle, notes } = JSON.parse(inspo);
        setForm((f) => ({ ...f, angle: angle ?? f.angle, notes: notes ?? f.notes }));
      } catch {
        /* ignore malformed */
      }
    }
  }, [load]);

  useEffect(() => {
    loadCreatives(selectedBrief);
    const t = setInterval(() => loadCreatives(selectedBrief), 5000);
    return () => clearInterval(t);
  }, [selectedBrief, loadCreatives]);

  async function createBrief() {
    if (!form.product.trim()) return;
    await fetch("/api/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        formats: form.formats.join(","),
        media_types: form.media_types.join(","),
      }),
    });
    setForm((f) => ({ ...f, product: "", offer: "", angle: "", notes: "" }));
    load();
  }

  async function updateSelected(patch: Partial<Creative>) {
    if (!selected) return;
    const next = { ...selected, ...patch };
    setSelected(next);
    setCreatives((cs) => cs.map((c) => (c.id === next.id ? next : c)));
    setSaving(true);
    await fetch("/api/creatives", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, ...patch }),
    });
    setSaving(false);
  }

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Ad Studio</h1>
      <p className="text-sm text-slate-500 mb-6">
        Describe the ad → the engine generates copy + Higgsfield visuals → preview exactly how it
        will look on Facebook.
      </p>
      <EngineBanner />

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr_400px] gap-6">
        {/* Brief form */}
        <div className="card p-4 h-fit">
          <h2 className="font-medium text-white text-sm mb-3 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-accent" /> New ad brief
          </h2>
          {learnings.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-[12px] text-amber-200/90">
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <Lightbulb className="w-3.5 h-3.5" /> From your performance data
              </div>
              {learnings.map((l) => (
                <div key={l.id} className="text-amber-200/70">• {l.insight}</div>
              ))}
            </div>
          )}
          <label className="label">Product / service *</label>
          <input className="input mb-3" value={form.product} placeholder="e.g. VAM Attendance app for schools"
            onChange={(e) => setForm({ ...form, product: e.target.value })} />
          <label className="label">Offer</label>
          <input className="input mb-3" value={form.offer} placeholder="e.g. 30-day free trial"
            onChange={(e) => setForm({ ...form, offer: e.target.value })} />
          <label className="label">Angle / hook direction</label>
          <input className="input mb-3" value={form.angle} placeholder="e.g. time saved vs paper rosters"
            onChange={(e) => setForm({ ...form, angle: e.target.value })} />
          <label className="label">Landing URL</label>
          <input className="input mb-3" value={form.landing_url} placeholder="https://…"
            onChange={(e) => setForm({ ...form, landing_url: e.target.value })} />
          <label className="label">Ideal customer profile</label>
          <select className="input mb-3" value={form.icp_id}
            onChange={(e) => setForm({ ...form, icp_id: Number(e.target.value) })}>
            {icps.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <label className="label">Formats</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.values(FORMAT_SPECS).map((s) => (
              <button key={s.id}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${
                  form.formats.includes(s.id)
                    ? "border-accent bg-accent/15 text-accent-soft"
                    : "border-line text-slate-500 hover:text-slate-300"
                }`}
                onClick={() => setForm({ ...form, formats: toggle(form.formats, s.id) })}>
                {s.label} · {s.aspect}
              </button>
            ))}
          </div>
          <label className="label">Media</label>
          <div className="flex gap-1.5 mb-3">
            {["image", "video"].map((m) => (
              <button key={m}
                className={`text-[12px] px-2.5 py-1 rounded-full border capitalize transition-colors ${
                  form.media_types.includes(m)
                    ? "border-accent bg-accent/15 text-accent-soft"
                    : "border-line text-slate-500 hover:text-slate-300"
                }`}
                onClick={() => setForm({ ...form, media_types: toggle(form.media_types, m) })}>
                {m}
              </button>
            ))}
          </div>
          <label className="label">Variants per format</label>
          <input type="number" min={1} max={6} className="input mb-3" value={form.variant_count}
            onChange={(e) => setForm({ ...form, variant_count: Number(e.target.value) })} />
          <label className="label">Notes for the engine</label>
          <textarea className="input mb-4" rows={2} value={form.notes}
            placeholder="brand colors, must-mention claims, style refs…"
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button className="btn-primary w-full" disabled={!form.product.trim() || !form.formats.length || !form.media_types.length}
            onClick={createBrief}>
            Queue generation
          </button>

          {briefs.length > 0 && (
            <div className="mt-5 border-t border-line pt-3">
              <div className="label">Briefs</div>
              <button
                className={`w-full text-left text-[13px] px-2 py-1.5 rounded ${selectedBrief === null ? "bg-surface-overlay text-white" : "text-slate-400 hover:bg-surface-overlay"}`}
                onClick={() => setSelectedBrief(null)}>
                All creatives
              </button>
              {briefs.map((b) => (
                <button key={b.id}
                  className={`w-full text-left text-[13px] px-2 py-1.5 rounded flex items-center justify-between gap-2 ${
                    selectedBrief === b.id ? "bg-surface-overlay text-white" : "text-slate-400 hover:bg-surface-overlay"
                  }`}
                  onClick={() => setSelectedBrief(b.id)}>
                  <span className="truncate">{b.product}</span>
                  <span className={`text-[11px] shrink-0 ${b.status === "generating" ? "text-amber-400" : "text-emerald-400"}`}>
                    {b.status === "generating" ? "generating…" : `${b.creative_count} ready`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Variant gallery */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-white text-sm">
              Variants {creatives.length ? `(${creatives.length})` : ""}
            </h2>
            <button className="btn-secondary !py-1 !px-2.5 text-[12px] flex items-center gap-1.5"
              onClick={() => loadCreatives(selectedBrief)}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
          {creatives.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-500">
              No creatives yet. Queue a brief, then run{" "}
              <code className="text-accent-soft">/process-jobs</code> in Claude Code.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {creatives.map((c) => {
                const src = c.asset_path
                  ? c.asset_path.startsWith("/") ? c.asset_path : `/${c.asset_path}`
                  : c.asset_url;
                return (
                  <button key={c.id}
                    className={`card overflow-hidden text-left transition-all ${
                      selected?.id === c.id ? "ring-2 ring-accent" : "hover:border-slate-600"
                    }`}
                    onClick={() => setSelected(c)}>
                    <div className="aspect-square bg-surface-overlay relative">
                      {src ? (
                        c.media_type === "video" ? (
                          <video src={src} className="w-full h-full object-cover" muted />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="w-full h-full object-cover" />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                          generating…
                        </div>
                      )}
                      {c.status === "approved" && (
                        <CheckCircle2 className="absolute top-2 right-2 w-5 h-5 text-emerald-400 drop-shadow" />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[12px] text-white truncate">{c.headline || "—"}</div>
                      <div className="text-[11px] text-slate-500">
                        {FORMAT_SPECS[c.format as keyof typeof FORMAT_SPECS]?.label ?? c.format} · {c.media_type}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Live preview + copy editor */}
        <div>
          <h2 className="font-medium text-white text-sm mb-3">
            Facebook preview {saving && <span className="text-slate-500 text-[11px]">saving…</span>}
          </h2>
          {selected ? (
            <div className="space-y-4">
              <div className="flex justify-center card p-5 bg-[#18191a]">
                <AdPreview creative={selected} />
              </div>
              <div className="card p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label !mb-1">Primary text</label>
                    <CharCounter value={selected.primary_text ?? ""} limit={COPY_LIMITS.primary_text} />
                  </div>
                  <textarea className="input" rows={3} value={selected.primary_text ?? ""}
                    onChange={(e) => updateSelected({ primary_text: e.target.value })} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label !mb-1">Headline</label>
                    <CharCounter value={selected.headline ?? ""} limit={COPY_LIMITS.headline} />
                  </div>
                  <input className="input" value={selected.headline ?? ""}
                    onChange={(e) => updateSelected({ headline: e.target.value })} />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label !mb-1">Description</label>
                    <CharCounter value={selected.description ?? ""} limit={COPY_LIMITS.description} />
                  </div>
                  <input className="input" value={selected.description ?? ""}
                    onChange={(e) => updateSelected({ description: e.target.value })} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="label !mb-1">Call to action</label>
                    <select className="input" value={selected.cta}
                      onChange={(e) => updateSelected({ cta: e.target.value })}>
                      {CTA_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    {selected.status === "approved" ? (
                      <button className="btn-secondary" onClick={() => updateSelected({ status: "generated" })}>
                        Unapprove
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={() => updateSelected({ status: "approved" })}>
                        Approve for launch
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-10 text-center text-sm text-slate-500">
              Select a variant to preview it as a Facebook ad.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
