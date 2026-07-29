"use client";

import {
  Activity,
  BarChart3,
  BookOpenCheck,
  FlaskConical,
  Gauge,
  RadioTower,
  ShieldCheck,
  WalletCards,
  Waves,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const NAVIGATION: Array<{
  href: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { href: "/", label: "Терминал", icon: Gauge },
  { href: "/strategy-builder", label: "Стратегия", icon: Waves },
  { href: "/signals", label: "Сигналы", icon: RadioTower },
  { href: "/auto-trading", label: "Исполнение", icon: Activity },
  { href: "/validation", label: "Forward", icon: ShieldCheck },
  { href: "/research", label: "Исследование", icon: FlaskConical },
  { href: "/exchanges", label: "Binance", icon: WalletCards },
];

function isRouteActive(pathname: string, href: Route) {
  return href === "/" ? pathname === "/" : pathname.startsWith(String(href));
}

export function BloombergHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/92 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-3 sm:px-4">
        <Link className="group flex shrink-0 items-center gap-2" href="/">
          <div className="strategy-glow flex size-8 items-center justify-center rounded-lg border border-primary/35 bg-primary/10">
            <BarChart3 className="size-4 text-primary transition-transform group-hover:scale-110" />
          </div>
          <div className="hidden leading-none sm:block">
            <div className="font-mono font-semibold text-sm tracking-[0.16em]">
              WIF<span className="text-primary">/</span>DOT
            </div>
            <div className="mt-1 text-[9px] text-muted-foreground uppercase tracking-[0.22em]">
              Risk Accelerator
            </div>
          </div>
        </Link>

        <div className="hidden h-7 w-px bg-border md:block" />

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAVIGATION.map(({ href, label, icon: Icon }) => {
            const active = isRouteActive(pathname, href);
            return (
              <Link
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                href={href}
                key={String(href)}
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-2.5 py-1.5 lg:flex">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Scheduler opt-in
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            aria-label="Документация стратегии"
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            href="/research"
          >
            <BookOpenCheck className="size-4" />
          </Link>
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
