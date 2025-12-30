import { cn } from "@/lib/utils";

interface TerminalPanelProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function TerminalPanel({
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
}: TerminalPanelProps) {
  return (
    <div className={cn("border border-border bg-card", className)}>
      <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs uppercase tracking-wider">
            {title}
          </span>
          {subtitle && (
            <span className="text-muted-foreground text-xs">{subtitle}</span>
          )}
        </div>
        {action && <div className="flex items-center gap-1">{action}</div>}
      </div>
      <div className={cn("p-2", contentClassName)}>{children}</div>
    </div>
  );
}

interface TerminalPanelHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function TerminalPanelHeader({
  children,
  className,
}: TerminalPanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between bg-muted/50 px-3 py-1.5",
        className
      )}
    >
      {children}
    </div>
  );
}

interface TerminalPanelContentProps {
  children: React.ReactNode;
  className?: string;
}

export function TerminalPanelContent({
  children,
  className,
}: TerminalPanelContentProps) {
  return <div className={cn("p-2", className)}>{children}</div>;
}
