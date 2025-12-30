"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Types
export interface TransportStats {
  lastAircraftCollection: string | null;
  lastVesselCollection: string | null;
  totalVessels: number;
  totalAircraft: number;
  totalPositions: number;
  totalSignals: number;
}

export interface Vessel {
  id: string;
  mmsi: string;
  name: string | null;
  vesselType: string;
  flag: string | null;
  deadweight: string | null;
  createdAt: string;
}

export interface Aircraft {
  id: string;
  icao24: string;
  callsign: string | null;
  aircraftType: string;
  operator: string | null;
  country: string | null;
  createdAt: string;
}

export interface TransportFlow {
  id: string;
  commodity: string;
  originRegion: string;
  destinationRegion: string;
  period: string;
  vesselCount: number;
  totalVolume: string;
  volumeChange: string | null;
  createdAt: string;
}

export interface TransportSignal {
  id: string;
  signalType: string;
  commodity: string | null;
  direction: "bullish" | "bearish" | "neutral";
  strength: string;
  confidence: string;
  description: string;
  affectedTickers: string[] | null;
  createdAt: string;
}

export interface VesselType {
  id: string;
  name: string;
  commodities: string[];
}

export interface AircraftType {
  id: string;
  name: string;
  description: string;
}

export interface Commodity {
  id: string;
  name: string;
  tickers: string[];
}

export interface Region {
  name: string;
  description: string;
}

export interface RegionActivity {
  region: string;
  vesselCount: number;
  aircraftCount: number;
  dominantCommodity: string | null;
  changePercent: number;
}

export interface CommodityVolume {
  commodity: string;
  totalVolume: number;
  vesselCount: number;
  changePercent: number;
}

export interface TransportOverview {
  stats: TransportStats;
  topSignals: TransportSignal[];
  topRegions: RegionActivity[];
  commodityVolumes: CommodityVolume[];
  lastUpdated: string;
}

export interface SchedulerStatus {
  isRunning: boolean;
  lastAircraftCollection: string | null;
  lastVesselCollection: string | null;
  lastAnalysis: string | null;
  aircraftInterval: number;
  vesselInterval: number;
  analysisInterval: number;
}

// Queries

export function useTransportStats() {
  return useQuery<TransportStats>({
    queryKey: ["transport", "stats"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/stats`);
      if (!res.ok) throw new Error("Failed to fetch transport stats");
      return res.json();
    },
    refetchInterval: 60_000, // 1 minute
  });
}

export function useTransportOverview() {
  return useQuery<TransportOverview>({
    queryKey: ["transport", "overview"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/overview`);
      if (!res.ok) throw new Error("Failed to fetch transport overview");
      return res.json();
    },
    refetchInterval: 30_000, // 30 seconds
  });
}

export function useVessels(options?: {
  vesselType?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options?.vesselType) params.set("vesselType", options.vesselType);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));

  return useQuery<{ vessels: Vessel[]; count: number }>({
    queryKey: ["transport", "vessels", options],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/vessels?${params}`);
      if (!res.ok) throw new Error("Failed to fetch vessels");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function useAircraft(options?: {
  aircraftType?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options?.aircraftType) params.set("aircraftType", options.aircraftType);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));

  return useQuery<{ aircraft: Aircraft[]; count: number }>({
    queryKey: ["transport", "aircraft", options],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/aircraft?${params}`);
      if (!res.ok) throw new Error("Failed to fetch aircraft");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function useTransportFlows(options?: {
  commodity?: string;
  periodType?: "daily" | "weekly" | "monthly";
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (options?.commodity) params.set("commodity", options.commodity);
  if (options?.periodType) params.set("periodType", options.periodType);
  if (options?.limit) params.set("limit", String(options.limit));

  return useQuery<{ flows: TransportFlow[]; count: number }>({
    queryKey: ["transport", "flows", options],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/flows?${params}`);
      if (!res.ok) throw new Error("Failed to fetch flows");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function useTransportSignals(options?: {
  commodity?: string;
  direction?: "bullish" | "bearish" | "neutral";
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (options?.commodity) params.set("commodity", options.commodity);
  if (options?.direction) params.set("direction", options.direction);
  if (options?.limit) params.set("limit", String(options.limit));

  return useQuery<{ signals: TransportSignal[]; count: number }>({
    queryKey: ["transport", "signals", options],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/signals?${params}`);
      if (!res.ok) throw new Error("Failed to fetch signals");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function useRegionActivity(hoursBack = 24) {
  return useQuery<{ activity: RegionActivity[]; hoursBack: number }>({
    queryKey: ["transport", "regions", "activity", hoursBack],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/api/transport/regions/activity?hoursBack=${hoursBack}`
      );
      if (!res.ok) throw new Error("Failed to fetch region activity");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function useCommodityVolumes(daysBack = 7) {
  return useQuery<{ volumes: CommodityVolume[]; daysBack: number }>({
    queryKey: ["transport", "commodities", "volumes", daysBack],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/api/transport/commodities/volumes?daysBack=${daysBack}`
      );
      if (!res.ok) throw new Error("Failed to fetch commodity volumes");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function useVesselTypes() {
  return useQuery<{ vesselTypes: VesselType[] }>({
    queryKey: ["transport", "vessel-types"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/vessel-types`);
      if (!res.ok) throw new Error("Failed to fetch vessel types");
      return res.json();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAircraftTypes() {
  return useQuery<{ aircraftTypes: AircraftType[] }>({
    queryKey: ["transport", "aircraft-types"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/aircraft-types`);
      if (!res.ok) throw new Error("Failed to fetch aircraft types");
      return res.json();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCommodities() {
  return useQuery<{ commodities: Commodity[] }>({
    queryKey: ["transport", "commodities"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/commodities`);
      if (!res.ok) throw new Error("Failed to fetch commodities");
      return res.json();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRegions() {
  return useQuery<{ regions: Region[] }>({
    queryKey: ["transport", "regions"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/regions`);
      if (!res.ok) throw new Error("Failed to fetch regions");
      return res.json();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useTransportSchedulerStatus() {
  return useQuery<SchedulerStatus>({
    queryKey: ["transport", "scheduler", "status"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/scheduler/status`);
      if (!res.ok) throw new Error("Failed to fetch scheduler status");
      return res.json();
    },
    refetchInterval: 10_000,
  });
}

// Mutations

export function useCollectTransportData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (source: "all" | "aircraft" | "vessels" = "all") => {
      const res = await fetch(`${API_URL}/api/transport/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) throw new Error("Failed to collect data");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport"] });
    },
  });
}

export function useAnalyzeTransportData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/analyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to analyze data");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transport"] });
    },
  });
}

export function useStartTransportScheduler() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/scheduler/start`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to start scheduler");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transport", "scheduler", "status"],
      });
    },
  });
}

export function useStopTransportScheduler() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/transport/scheduler/stop`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to stop scheduler");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transport", "scheduler", "status"],
      });
    },
  });
}
