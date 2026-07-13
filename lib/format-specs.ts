// Facebook ad format specifications used for generation, validation, and preview.

export type AdFormat = "feed_square" | "feed_portrait" | "story_vertical" | "landscape";

export interface FormatSpec {
  id: AdFormat;
  label: string;
  placement: string;
  width: number;
  height: number;
  aspect: string; // e.g. "1:1"
}

export const FORMAT_SPECS: Record<AdFormat, FormatSpec> = {
  feed_square: {
    id: "feed_square",
    label: "Feed — Square",
    placement: "Facebook/Instagram Feed",
    width: 1080,
    height: 1080,
    aspect: "1:1",
  },
  feed_portrait: {
    id: "feed_portrait",
    label: "Feed — Portrait",
    placement: "Facebook/Instagram Feed",
    width: 1080,
    height: 1350,
    aspect: "4:5",
  },
  story_vertical: {
    id: "story_vertical",
    label: "Story / Reel",
    placement: "Stories & Reels",
    width: 1080,
    height: 1920,
    aspect: "9:16",
  },
  landscape: {
    id: "landscape",
    label: "Landscape",
    placement: "In-stream / Right column",
    width: 1200,
    height: 628,
    aspect: "1.91:1",
  },
};

// Character limits before Facebook truncates copy in most placements.
export const COPY_LIMITS = {
  primary_text: 125,
  headline: 40,
  description: 30,
} as const;

export const CTA_OPTIONS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "GET_OFFER",
  "SUBSCRIBE",
  "CONTACT_US",
  "DOWNLOAD",
  "BOOK_TRAVEL",
  "GET_QUOTE",
] as const;

export const OBJECTIVES = [
  { id: "OUTCOME_TRAFFIC", label: "Traffic", goal: "LINK_CLICKS" },
  { id: "OUTCOME_SALES", label: "Sales / Conversions", goal: "OFFSITE_CONVERSIONS" },
  { id: "OUTCOME_LEADS", label: "Leads", goal: "LEAD_GENERATION" },
  { id: "OUTCOME_AWARENESS", label: "Awareness", goal: "REACH" },
  { id: "OUTCOME_ENGAGEMENT", label: "Engagement", goal: "POST_ENGAGEMENT" },
] as const;

export function copyIssues(copy: {
  primary_text?: string | null;
  headline?: string | null;
  description?: string | null;
}): string[] {
  const issues: string[] = [];
  const pt = copy.primary_text ?? "";
  const hl = copy.headline ?? "";
  const ds = copy.description ?? "";
  if (!pt) issues.push("Missing primary text");
  if (!hl) issues.push("Missing headline");
  if (pt.length > COPY_LIMITS.primary_text)
    issues.push(`Primary text ${pt.length}/${COPY_LIMITS.primary_text} — will truncate`);
  if (hl.length > COPY_LIMITS.headline)
    issues.push(`Headline ${hl.length}/${COPY_LIMITS.headline} — will truncate`);
  if (ds.length > COPY_LIMITS.description)
    issues.push(`Description ${ds.length}/${COPY_LIMITS.description} — will truncate`);
  return issues;
}
