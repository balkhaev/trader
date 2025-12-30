"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ResultsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Pie chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex items-center justify-center">
          <Skeleton className="size-[200px] rounded-full" />
        </CardContent>
      </Card>

      {/* Metrics skeleton */}
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="flex justify-between" key={i}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
