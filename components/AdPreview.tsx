"use client";

import { ThumbsUp, MessageCircle, Share2, MoreHorizontal, Globe, X } from "lucide-react";
import { COPY_LIMITS, FORMAT_SPECS, type AdFormat } from "@/lib/format-specs";

export interface PreviewCreative {
  media_type: string;
  format: string;
  asset_path?: string | null;
  asset_url?: string | null;
  primary_text?: string | null;
  headline?: string | null;
  description?: string | null;
  cta?: string | null;
  landing_url?: string | null;
}

function assetSrc(c: PreviewCreative): string | null {
  if (c.asset_path) return c.asset_path.startsWith("/") ? c.asset_path : `/${c.asset_path}`;
  return c.asset_url ?? null;
}

function domain(url?: string | null): string {
  if (!url) return "yoursite.com";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toUpperCase();
  } catch {
    return url.toUpperCase();
  }
}

function ctaLabel(cta?: string | null): string {
  return (cta ?? "LEARN_MORE")
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

function Media({ c, className }: { c: PreviewCreative; className: string }) {
  const src = assetSrc(c);
  if (!src) {
    const spec = FORMAT_SPECS[c.format as AdFormat];
    return (
      <div className={`${className} flex items-center justify-center bg-surface-overlay text-slate-600 text-xs`}>
        {c.media_type} · {spec ? `${spec.width}×${spec.height}` : c.format} — awaiting generation
      </div>
    );
  }
  if (c.media_type === "video") {
    return <video src={src} className={`${className} object-cover`} controls muted loop playsInline />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="ad creative" className={`${className} object-cover`} />;
}

/** Pixel-faithful Facebook Feed post mockup. */
function FeedPreview({ c, pageName }: { c: PreviewCreative; pageName: string }) {
  const pt = c.primary_text ?? "";
  const truncated = pt.length > COPY_LIMITS.primary_text;
  const shown = truncated ? pt.slice(0, COPY_LIMITS.primary_text) : pt;
  const ratio = c.format === "feed_portrait" ? "aspect-[4/5]" : "aspect-square";
  return (
    <div className="w-[380px] bg-[#242526] rounded-lg overflow-hidden text-[#e4e6eb] shadow-xl border border-black/40 font-sans">
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold">
          {pageName[0]?.toUpperCase() ?? "P"}
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-semibold leading-tight">{pageName}</div>
          <div className="text-[12px] text-[#b0b3b8] flex items-center gap-1">
            Sponsored · <Globe className="w-3 h-3" />
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-[#b0b3b8]" />
        <X className="w-5 h-5 text-[#b0b3b8]" />
      </div>
      <div className="px-4 pb-2 text-[14px] leading-snug whitespace-pre-wrap">
        {shown}
        {truncated && <span className="text-[#b0b3b8]"> …See more</span>}
      </div>
      <Media c={c} className={`w-full ${ratio}`} />
      <div className="flex items-center justify-between bg-[#3a3b3c] px-4 py-2.5">
        <div className="min-w-0 pr-3">
          <div className="text-[12px] text-[#b0b3b8] tracking-wide">{domain(c.landing_url)}</div>
          <div className="text-[15px] font-semibold truncate">{c.headline || "Headline goes here"}</div>
          {c.description ? (
            <div className="text-[13px] text-[#b0b3b8] truncate">{c.description}</div>
          ) : null}
        </div>
        <button className="shrink-0 bg-[#4e4f50] hover:bg-[#5a5b5c] text-[14px] font-semibold px-4 py-1.5 rounded-md">
          {ctaLabel(c.cta)}
        </button>
      </div>
      <div className="flex items-center justify-around border-t border-[#3a3b3c] mx-3 py-1 text-[#b0b3b8] text-[13px] font-medium">
        <span className="flex items-center gap-1.5 py-1.5"><ThumbsUp className="w-4 h-4" /> Like</span>
        <span className="flex items-center gap-1.5 py-1.5"><MessageCircle className="w-4 h-4" /> Comment</span>
        <span className="flex items-center gap-1.5 py-1.5"><Share2 className="w-4 h-4" /> Share</span>
      </div>
    </div>
  );
}

/** Story / Reel phone-frame mockup (9:16). */
function StoryPreview({ c, pageName }: { c: PreviewCreative; pageName: string }) {
  return (
    <div className="w-[260px] aspect-[9/16] bg-black rounded-3xl overflow-hidden relative shadow-xl border border-black/60">
      <Media c={c} className="absolute inset-0 w-full h-full" />
      <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="h-0.5 bg-white/40 rounded-full mb-2.5">
          <div className="h-full w-1/3 bg-white rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white text-sm font-bold">
            {pageName[0]?.toUpperCase() ?? "P"}
          </div>
          <div>
            <div className="text-white text-[13px] font-semibold leading-tight">{pageName}</div>
            <div className="text-white/70 text-[11px]">Sponsored</div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        {c.headline ? (
          <div className="text-white text-[14px] font-semibold mb-2 leading-snug">{c.headline}</div>
        ) : null}
        <button className="w-full bg-white text-black text-[14px] font-semibold py-2 rounded-full">
          {ctaLabel(c.cta)}
        </button>
      </div>
    </div>
  );
}

export default function AdPreview({
  creative,
  pageName = "Your Page",
}: {
  creative: PreviewCreative;
  pageName?: string;
}) {
  if (creative.format === "story_vertical") {
    return <StoryPreview c={creative} pageName={pageName} />;
  }
  return <FeedPreview c={creative} pageName={pageName} />;
}
