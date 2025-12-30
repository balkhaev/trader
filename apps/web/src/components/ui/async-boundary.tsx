"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

interface AsyncBoundaryProps<T> {
  /** Loading state */
  isLoading: boolean;
  /** Error object */
  error?: Error | null;
  /** Data to render */
  data: T | undefined | null;
  /** Render function when data is available */
  children: (data: T) => React.ReactNode;
  /** Custom loading component */
  loadingFallback?: React.ReactNode;
  /** Component to show when data is empty */
  emptyState?: React.ReactNode;
  /** Retry function for errors */
  onRetry?: () => void;
  /** Custom error component */
  errorFallback?: (error: Error, retry?: () => void) => React.ReactNode;
  /** Additional className for container */
  className?: string;
}

/**
 * Check if data is empty (null, undefined, empty array, or empty object)
 */
function isEmpty<T>(data: T): boolean {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") return Object.keys(data).length === 0;
  return false;
}

/**
 * Default loading skeleton
 */
function DefaultLoadingFallback() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
    </div>
  );
}

/**
 * Default empty state
 */
function DefaultEmptyState({
  message = "No data available",
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
      <p className="text-sm">{message}</p>
    </div>
  );
}

/**
 * Default error state
 */
function DefaultErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h3 className="font-medium text-sm">Something went wrong</h3>
        <p className="text-muted-foreground text-xs">{error.message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} size="sm" variant="outline">
          <RefreshCw className="mr-2 h-3 w-3" />
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * AsyncBoundary - Unified component for handling async states
 *
 * Handles loading, error, and empty states in a consistent way.
 *
 * @example
 * ```tsx
 * <AsyncBoundary
 *   isLoading={isLoading}
 *   error={error}
 *   data={data}
 *   onRetry={refetch}
 *   emptyState={<EmptyUsers />}
 * >
 *   {(users) => <UserList users={users} />}
 * </AsyncBoundary>
 * ```
 */
export function AsyncBoundary<T>({
  isLoading,
  error,
  data,
  children,
  loadingFallback,
  emptyState,
  onRetry,
  errorFallback,
  className,
}: AsyncBoundaryProps<T>) {
  // Loading state
  if (isLoading) {
    return (
      <div className={cn(className)}>
        {loadingFallback ?? <DefaultLoadingFallback />}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn(className)}>
        {errorFallback ? (
          errorFallback(error, onRetry)
        ) : (
          <DefaultErrorState error={error} onRetry={onRetry} />
        )}
      </div>
    );
  }

  // Empty state
  if (isEmpty(data)) {
    return (
      <div className={cn(className)}>{emptyState ?? <DefaultEmptyState />}</div>
    );
  }

  // Data available - render children
  return <>{children(data as T)}</>;
}

// ===== Specialized variants =====

interface ListBoundaryProps<T>
  extends Omit<AsyncBoundaryProps<T[]>, "children"> {
  children: (items: T[]) => React.ReactNode;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
}

/**
 * ListBoundary - Specialized for rendering lists
 */
export function ListBoundary<T>({
  emptyMessage = "No items found",
  emptyIcon,
  ...props
}: ListBoundaryProps<T>) {
  return (
    <AsyncBoundary
      {...props}
      emptyState={
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          {emptyIcon && <div className="mb-2">{emptyIcon}</div>}
          <p className="text-sm">{emptyMessage}</p>
        </div>
      }
    />
  );
}

interface CardBoundaryProps<T> extends AsyncBoundaryProps<T> {
  /** Number of skeleton cards to show while loading */
  skeletonCount?: number;
  /** Height of skeleton cards */
  skeletonHeight?: string;
}

/**
 * CardBoundary - Specialized for card grids
 */
export function CardBoundary<T>({
  skeletonCount = 3,
  skeletonHeight = "h-32",
  loadingFallback,
  ...props
}: CardBoundaryProps<T>) {
  return (
    <AsyncBoundary
      {...props}
      loadingFallback={
        loadingFallback ?? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <Skeleton
                className={cn("w-full rounded-lg", skeletonHeight)}
                key={i}
              />
            ))}
          </div>
        )
      }
    />
  );
}
