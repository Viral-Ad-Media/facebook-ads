"use client";

import { useCallback, useEffect, useState } from "react";
import { Binoculars, Star, ExternalLink, ArrowRight, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import EngineBanner from "@/components/EngineBanner";
import { getJson } from "@/lib/client";

type CompetitorAd = {
  id: number;
  query: string;
  page_name: string;
  library_id: string;
  body?: string;
  headline?: string;
  cta?: string;
  media_type?: string;
  media_url?: string;
  snapshot_url?: string;
  started_at?: string;
  platforms?: string;
  analysis?: string;
  starred: number;
};

type QueryGroup = { query: string; c: number; last: string };

function daysRunning(started?: string): number | null {
  if (!started) return null;
  const ms = Date.now() - new Date(started).getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : null;
}

export default function CompetitorsPage() {
  const [ads, setAds] = useState<CompetitorAd[]>([]);
  const [queries, setQueries] = useState<QueryGroup[]>([]);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("US");
  const [queued, setQueued] = useState(false);
  const router = useRouter();

  const load = useCallback(async (q: string | null) => {
    const url = q ? `/api/competitor-ads?query=${encodeURIComponent(q)}` : "/api/competitor-ads";
    const data = await getJson<{ ads: CompetitorAd[]; queries: QueryGroup[] }>(url, {
      ads: [],
      queries: [],
    });
    setAds(data.ads);
    setQueries(data.queries);
  }, []);

  useEffect(() => {
    load(activeQuery);
    const t = setInterval(() => load(activeQuery), 6000);
    return () => clearInterval(t);
  }, [activeQuery, load]);

  async function scan() {
    if (!search.trim()) return;
    await fetch("/api/competitor-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: search.trim(), country }),
    });
    setQueued(true);
    setActiveQuery(search.trim());
    setTimeout(() => setQueued(false), 4000);
  }

  async function toggleStar(ad: CompetitorAd) {
    await fetch("/api/competitor-ads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ad.id, starred: ad.starred ? 0 : 1 }),
    });
    load(activeQuery);
  }

  function useAsInspiration(ad: CompetitorAd) {
    const inspo = {
      angle: ad.analysis || `Inspired by ${ad.page_name}: "${(ad.headline || ad.body || "").slice(0, 80)}"`,
      notes: `Competitor reference — ${ad.page_name} (running ${daysRunning(ad.started_at) ?? "?"} days): ${(ad.body || "").slice(0, 200)}`,
    };
    sessionStorage.setItem("inspiration", JSON.stringify(inspo));
    router.push("/studio");
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Competitor analysis</h1>
      <p className="text-sm text-slate-500 mb-6">
        Pull competitors&apos; running ads from the Meta Ads Library. Ads that have run for{" "}
        <span className="text-slate-300">months</span> are paying for themselves — steal the angle,
        not the ad.
      </p>
      <EngineBanner />
      {queued && (
        <div className="card border-emerald-500/40 bg-emerald-500/10 px-4 py-3 mb-6 text-sm text-emerald-200">
          Scan queued. Run <code>/competitor-scan</code> in Claude Code to pull ads from the Meta
          Ads Library.
        </div>
      )}

      <div className="card p-4 mb-6 flex gap-3 items-end">
        <div className="flex-1">
          <label className="label">Brand, competitor, or keyword</label>
          <input className="input" value={search} placeholder="e.g. ClickFunnels, school attendance software…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()} />
        </div>
        <div className="w-24">
          <label className="label">Country</label>
          <input className="input" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
        </div>
        <button className="btn-primary flex items-center gap-2" disabled={!search.trim()} onClick={scan}>
          <Binoculars className="w-4 h-4" /> Scan ads library
        </button>
      </div>

      {queries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          <button
            className={`text-[12px] px-2.5 py-1 rounded-full border ${activeQuery === null ? "border-accent bg-accent/15 text-accent-soft" : "border-line text-slate-500 hover:text-slate-300"}`}
            onClick={() => setActiveQuery(null)}>
            All
          </button>
          {queries.map((q) => (
            <button key={q.query}
              className={`text-[12px] px-2.5 py-1 rounded-full border ${activeQuery === q.query ? "border-accent bg-accent/15 text-accent-soft" : "border-line text-slate-500 hover:text-slate-300"}`}
              onClick={() => setActiveQuery(q.query)}>
              {q.query} ({q.c})
            </button>
          ))}
        </div>
      )}

      {ads.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          No competitor ads collected yet. Search a brand above, then run{" "}
          <code className="text-accent-soft">/competitor-scan</code> in Claude Code.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ads.map((ad) => {
            const days = daysRunning(ad.started_at);
            const winner = days !== null && days >= 60;
            return (
              <div key={ad.id} className={`card p-4 flex flex-col ${winner ? "border-amber-500/40" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-white text-sm truncate">{ad.page_name}</div>
                  <button onClick={() => toggleStar(ad)} title="Star">
                    <Star className={`w-4 h-4 ${ad.starred ? "text-amber-400 fill-amber-400" : "text-slate-600 hover:text-slate-400"}`} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2 text-[11px]">
                  {days !== null && (
                    <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${winner ? "bg-amber-400/15 text-amber-300" : "bg-slate-400/10 text-slate-400"}`}>
                      {winner && <Trophy className="w-3 h-3" />} running {days}d
                    </span>
                  )}
                  {ad.media_type && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-400/10 text-sky-300">{ad.media_type}</span>
                  )}
                  {ad.platforms && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-400/10 text-slate-400">{ad.platforms}</span>
                  )}
                </div>
                {ad.media_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.media_url} alt="" className="rounded-lg mb-2 max-h-48 object-cover w-full" />
                )}
                {ad.headline && <div className="text-[13px] font-medium text-slate-200 mb-1">{ad.headline}</div>}
                {ad.body && <div className="text-[12px] text-slate-400 line-clamp-4 mb-2">{ad.body}</div>}
                {ad.analysis && (
                  <div className="text-[12px] text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 mb-2">
                    {ad.analysis}
                  </div>
                )}
                <div className="mt-auto pt-2 flex items-center justify-between">
                  {ad.snapshot_url ? (
                    <a href={ad.snapshot_url} target="_blank" rel="noreferrer"
                      className="text-[12px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
                      Ads Library <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : <span />}
                  <button className="text-[12px] text-accent-soft hover:text-accent flex items-center gap-1"
                    onClick={() => useAsInspiration(ad)}>
                    Use as inspiration <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
