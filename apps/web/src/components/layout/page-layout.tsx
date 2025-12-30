import { ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  backLink?: {
    href: Route;
    label: string;
  };
}

export function PageLayout({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
  backLink,
}: PageLayoutProps) {
  return (
    <div className={cn("flex flex-col gap-4 p-4", className)}>
      {backLink && (
        <Link
          className="flex w-fit items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
          href={backLink.href}
        >
          <ChevronLeft className="size-3" />
          {backLink.label}
        </Link>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-lg uppercase tracking-wide">
            {title}
          </h1>
          {subtitle && (
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("flex-1", contentClassName)}>{children}</div>
    </div>
  );
}

interface StatRowProps {
  children: React.ReactNode;
  className?: string;
}

export function StatRow({ children, className }: StatRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px bg-border md:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string | number;
  change?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export function StatItem({ label, value, change, className }: StatItemProps) {
  return (
    <div className={cn("bg-card px-3 py-2", className)}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-semibold text-lg">{value}</span>
        {change && (
          <span
            className={cn(
              "font-mono text-xs",
              change.isPositive ? "text-green-500" : "text-red-500"
            )}
          >
            {change.isPositive ? "+" : ""}
            {change.value}%
          </span>
        )}
      </div>
    </div>
  );
}
