"use client";

import { AlertTriangle, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ErrorStateProps {
  /** Error object or message */
  error: Error | string;
  /** Retry callback */
  onRetry?: () => void;
  /** Title override */
  title?: string;
  /** Additional className */
  className?: string;
  /** Size variant */
  size?: "sm" | "default" | "lg";
  /** Severity level */
  severity?: "warning" | "error";
}

const sizeClasses = {
  sm: {
    container: "py-4 gap-2",
    icon: "h-4 w-4",
    iconContainer: "h-8 w-8",
    title: "text-xs",
    message: "text-xs",
    button: "sm" as const,
  },
  default: {
    container: "py-8 gap-3",
    icon: "h-5 w-5",
    iconContainer: "h-10 w-10",
    title: "text-sm",
    message: "text-xs",
    button: "sm" as const,
  },
  lg: {
    container: "py-12 gap-4",
    icon: "h-6 w-6",
    iconContainer: "h-12 w-12",
    title: "text-base",
    message: "text-sm",
    button: "default" as const,
  },
};

const severityConfig = {
  warning: {
    icon: AlertTriangle,
    containerClass: "bg-yellow-500/10",
    iconClass: "text-yellow-500",
  },
  error: {
    icon: XCircle,
    containerClass: "bg-destructive/10",
    iconClass: "text-destructive",
  },
};

/**
 * ErrorState - Consistent error state component
 *
 * @example
 * ```tsx
 * <ErrorState
 *   error={error}
 *   onRetry={refetch}
 *   title="Failed to load data"
 * />
 * ```
 */
export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
  className,
  size = "default",
  severity = "error",
}: ErrorStateProps) {
  const classes = sizeClasses[size];
  const config = severityConfig[severity];
  const Icon = config.icon;

  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        classes.container,
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full",
          classes.iconContainer,
          config.containerClass
        )}
      >
        <Icon className={cn(classes.icon, config.iconClass)} />
      </div>
      <h3 className={cn("font-medium", classes.title)}>{title}</h3>
      <p className={cn("text-muted-foreground", classes.message)}>
        {errorMessage}
      </p>
      {onRetry && (
        <Button
          className="mt-3"
          onClick={onRetry}
          size={classes.button}
          variant="outline"
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * InlineError - Compact inline error message
 */
export function InlineError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm",
        className
      )}
    >
      <XCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
