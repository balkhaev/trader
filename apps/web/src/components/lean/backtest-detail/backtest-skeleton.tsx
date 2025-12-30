import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BacktestSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>

      {/* Key Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-20" />
            <div className="flex gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton className="h-8 w-24" key={i} />
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[350px] w-full" />
        </CardContent>
      </Card>

      {/* Trades Table */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-8 w-32" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton className="h-12 w-full" key={i} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton className="h-8 w-24" key={i} />
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton className="h-12 w-full" key={i} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
