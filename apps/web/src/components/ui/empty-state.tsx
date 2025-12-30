"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface EmptyStateProps {
  /** Icon to display */
  icon?: LucideIcon;
  /** Title text */
  title: string;
  /** Description text */
  description?: string;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "secondary";
  };
  /** Additional className */
  className?: string;
  /** Size variant */
  size?: "sm" | "default" | "lg";
}

const sizeClasses = {
  sm: {
    container: "py-6",
    icon: "h-8 w-8",
    iconContainer: "h-12 w-12",
    title: "text-sm",
    description: "text-xs",
  },
  default: {
    container: "py-12",
    icon: "h-10 w-10",
    iconContainer: "h-16 w-16",
    title: "text-base",
    description: "text-sm",
  },
  lg: {
    container: "py-16",
    icon: "h-12 w-12",
    iconContainer: "h-20 w-20",
    title: "text-lg",
    description: "text-base",
  },
};

/**
 * EmptyState - Consistent empty state component
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={Inbox}
 *   title="No messages"
 *   description="You don't have any messages yet"
 *   action={{ label: "Compose", onClick: handleCompose }}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "default",
}: EmptyStateProps) {
  const classes = sizeClasses[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        classes.container,
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-4 flex items-center justify-center rounded-full bg-muted",
            classes.iconContainer
          )}
        >
          <Icon className={cn("text-muted-foreground", classes.icon)} />
        </div>
      )}
      <h3 className={cn("font-medium", classes.title)}>{title}</h3>
      {description && (
        <p className={cn("mt-1 text-muted-foreground", classes.description)}>
          {description}
        </p>
      )}
      {action && (
        <Button
          className="mt-4"
          onClick={action.onClick}
          size={size === "sm" ? "sm" : "default"}
          variant={action.variant ?? "default"}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
