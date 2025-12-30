import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PageLoadingProps {
  variant?: "page" | "table" | "cards";
  count?: number;
  className?: string;
}

export function PageLoading({
  variant = "page",
  count = 3,
  className,
}: PageLoadingProps) {
  if (variant === "table") {
    return (
      <div className={cn("space-y-2", className)}>
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton className="h-12 w-full" key={i} />
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div
        className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}
      >
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton className="h-32 w-full" key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-px bg-border md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton className="h-16" key={i} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
