"use client";

import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  Database,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Newspaper,
  PenTool,
  Ship,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

interface NavItemProps {
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  badge?: number;
  isActive?: boolean;
}

function NavItem({
  href,
  icon: Icon,
  children,
  badge,
  isActive,
}: NavItemProps) {
  return (
    <Link
      className={cn(
        "flex h-7 items-center gap-1.5 rounded px-2 font-medium text-xs transition-colors",
        "hover:bg-muted",
        isActive && "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
      href={href}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-medium text-[10px] text-destructive-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function NavGroup({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        highlight && "rounded bg-muted/50 p-1"
      )}
    >
      {children}
    </div>
  );
}

function Separator() {
  return <div className="mx-2 h-5 w-px bg-border" />;
}

export function BloombergHeader() {
  const pathname = usePathname();

  // TODO: получить количество pending сигналов из API
  const pendingSignalsCount = 0;

  return (
    <header className="sticky top-0 z-50 h-10 border-b bg-background">
      <div className="flex h-full items-center px-4">
        {/* Logo */}
        <Link className="flex items-center gap-2" href="/">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm tracking-tight">TRADER</span>
        </Link>

        <Separator />

        {/* Primary Navigation - Dashboard + Agents + Markets */}
        <NavGroup highlight>
          <NavItem href="/" icon={LayoutDashboard} isActive={pathname === "/"}>
            Dashboard
          </NavItem>
          <NavItem
            href="/agents"
            icon={Bot}
            isActive={pathname.startsWith("/agents")}
          >
            Agents
          </NavItem>
          <NavItem
            href="/markets"
            icon={TrendingUp}
            isActive={pathname.startsWith("/markets")}
          >
            Markets
          </NavItem>
          <NavItem
            badge={pendingSignalsCount}
            href="/signals"
            icon={Bell}
            isActive={pathname.startsWith("/signals")}
          >
            Signals
          </NavItem>
        </NavGroup>

        <Separator />

        {/* Trading Navigation */}
        <NavGroup>
          <NavItem
            href="/market"
            icon={BarChart3}
            isActive={pathname.startsWith("/market")}
          >
            Market
          </NavItem>
          <NavItem
            href="/strategies"
            icon={Brain}
            isActive={pathname.startsWith("/strategies")}
          >
            Strategies
          </NavItem>
          <NavItem
            href="/strategy-builder"
            icon={PenTool}
            isActive={pathname.startsWith("/strategy-builder")}
          >
            Builder
          </NavItem>
          <NavItem
            href="/backtests"
            icon={FlaskConical}
            isActive={pathname.startsWith("/backtests")}
          >
            Backtests
          </NavItem>
        </NavGroup>

        <Separator />

        {/* Intelligence Navigation */}
        <NavGroup>
          <NavItem
            href="/intelligence"
            icon={GitBranch}
            isActive={pathname.startsWith("/intelligence")}
          >
            Intelligence
          </NavItem>
          <NavItem
            href="/transport"
            icon={Ship}
            isActive={pathname.startsWith("/transport")}
          >
            Transport
          </NavItem>
          <NavItem
            href="/trends"
            icon={Sparkles}
            isActive={pathname.startsWith("/trends")}
          >
            Trends
          </NavItem>
          <NavItem
            href="/news"
            icon={Newspaper}
            isActive={pathname.startsWith("/news")}
          >
            News
          </NavItem>
        </NavGroup>

        <Separator />

        {/* System Navigation */}
        <NavGroup>
          <NavItem
            href="/exchanges"
            icon={Wallet}
            isActive={pathname.startsWith("/exchanges")}
          >
            Exchanges
          </NavItem>
          <NavItem
            href="/data"
            icon={Database}
            isActive={pathname.startsWith("/data")}
          >
            Data
          </NavItem>
        </NavGroup>

        <Separator />

        {/* Portfolio */}
        <NavGroup>
          <NavItem
            href="/my"
            icon={Wallet}
            isActive={pathname.startsWith("/my")}
          >
            Portfolio
          </NavItem>
        </NavGroup>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Utilities */}
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
