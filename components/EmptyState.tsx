"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Rich empty-state guide: shown on blank screens to explain what belongs here
 * and the exact steps to get there.
 */
export default function EmptyState({
  icon: Icon,
  title,
  steps,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  steps: string[];
  cta?: { label: string; href: string };
}) {
  return (
    <div className="card p-10 max-w-xl mx-auto text-center">
      <Icon className="w-10 h-10 text-accent mx-auto mb-3" />
      <h3 className="text-white font-semibold mb-4">{title}</h3>
      <ol className="text-left text-[13px] text-slate-400 space-y-2.5 mb-6 mx-auto w-fit">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent-soft text-[11px] font-semibold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <span dangerouslySetInnerHTML={{ __html: s }} />
          </li>
        ))}
      </ol>
      {cta && (
        <Link href={cta.href} className="btn-primary inline-block">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
