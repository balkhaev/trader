"use client";

import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
import {
  CommodityVolumeChart,
  RegionActivityList,
  TransportOverviewCard,
  TransportSchedulerControl,
  TransportSignalsTable,
  VesselList,
} from "@/components/transport";
import {
  useCommodityVolumes,
  useRegionActivity,
  useTransportOverview,
  useTransportSignals,
  useTransportStats,
  useVessels,
} from "@/hooks/use-transport";

export default function TransportPage() {
  const statsQuery = useTransportStats();
  const overviewQuery = useTransportOverview();
  const signalsQuery = useTransportSignals({ limit: 10 });
  const regionQuery = useRegionActivity(24);
  const volumesQuery = useCommodityVolumes(7);
  const vesselsQuery = useVessels({ limit: 10 });

  const stats = statsQuery.data;

  return (
    <PageLayout
      subtitle="Vessel and aircraft tracking for commodity intelligence"
      title="Transport Intelligence"
    >
      {/* Stats Row */}
      <StatRow>
        <StatItem label="Active Vessels" value={stats?.totalVessels ?? "..."} />
        <StatItem
          label="Active Aircraft"
          value={stats?.totalAircraft ?? "..."}
        />
        <StatItem label="Positions" value={stats?.totalPositions ?? "..."} />
        <StatItem label="Active Signals" value={stats?.totalSignals ?? "..."} />
      </StatRow>

      {/* Overview Card */}
      <div className="mt-4">
        <TransportOverviewCard data={stats} isLoading={statsQuery.isLoading} />
      </div>

      {/* Main Grid */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Left Column - Scheduler & Regions */}
        <div className="space-y-4">
          <TransportSchedulerControl />
          <RegionActivityList
            isLoading={regionQuery.isLoading}
            regions={regionQuery.data?.activity}
          />
        </div>

        {/* Middle Column - Signals */}
        <div className="lg:col-span-2">
          <TransportSignalsTable
            isLoading={signalsQuery.isLoading}
            signals={signalsQuery.data?.signals}
            title="Active Trading Signals"
          />
        </div>
      </div>

      {/* Volumes & Vessels */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CommodityVolumeChart
          isLoading={volumesQuery.isLoading}
          volumes={volumesQuery.data?.volumes}
        />
        <VesselList
          isLoading={vesselsQuery.isLoading}
          title="Recently Tracked Vessels"
          vessels={vesselsQuery.data?.vessels}
        />
      </div>
    </PageLayout>
  );
}
