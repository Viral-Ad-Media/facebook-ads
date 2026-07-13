"use client";

export default function CharCounter({ value, limit }: { value: string; limit: number }) {
  const len = value.length;
  const over = len > limit;
  return (
    <span className={`text-[11px] tabular-nums ${over ? "text-red-400 font-semibold" : "text-slate-500"}`}>
      {len}/{limit}
      {over ? " — truncates" : ""}
    </span>
  );
}
