"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wand2,
  Rocket,
  Lightbulb,
  Settings,
  Megaphone,
  Binoculars,
} from "lucide-react";

const links = [
  { href: "/", label: "Campaigns", icon: LayoutDashboard },
  { href: "/competitors", label: "Competitors", icon: Binoculars },
  { href: "/studio", label: "Ad Studio", icon: Wand2 },
  { href: "/launch", label: "Launch", icon: Rocket },
  { href: "/learnings", label: "Learnings", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-line bg-surface-raised/50 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 py-3 mb-4">
        <Megaphone className="w-6 h-6 text-accent" />
        <div>
          <div className="font-semibold text-sm text-white leading-tight">Facebook Ads</div>
          <div className="text-[11px] text-slate-500">Studio &amp; Engine</div>
        </div>
      </div>
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? "bg-accent/15 text-accent-soft font-medium"
                : "text-slate-400 hover:text-slate-200 hover:bg-surface-overlay"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto px-3 py-2 text-[11px] text-slate-600 leading-relaxed">
        Engine runs via Claude Code:
        <code className="block mt-1 text-slate-500">/process-jobs · /launch · /monitor</code>
      </div>
    </aside>
  );
}
