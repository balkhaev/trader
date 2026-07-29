"use client";

import { Bot, ListChecks, PlayCircle, Settings2 } from "lucide-react";
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
  { href: "/", label: "Торговля", icon: PlayCircle },
  { href: "/signals", label: "Сделки", icon: ListChecks },
  { href: "/auto-trading", label: "Настройки", icon: Settings2 },
];

function isRouteActive(pathname: string, href: Route) {
  return href === "/" ? pathname === "/" : pathname.startsWith(String(href));
}

export function BloombergHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-border/80 border-b bg-background/92 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-3 sm:px-4">
        <Link className="group flex shrink-0 items-center gap-2" href="/">
          <div className="strategy-glow flex size-8 items-center justify-center border border-primary/35 bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
          <div className="hidden leading-none sm:block">
            <div className="font-semibold text-sm tracking-tight">Trader</div>
            <div className="mt-1 text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
              автоторговля
            </div>
          </div>
        </Link>

        <div className="hidden h-7 w-px bg-border md:block" />

        <nav
          aria-label="Основная навигация"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAVIGATION.map(({ href, label, icon: Icon }) => {
            const active = isRouteActive(pathname, href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 px-3 text-xs transition-colors",
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

        <div className="flex shrink-0 items-center gap-1">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
