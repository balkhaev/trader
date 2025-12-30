import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { transportScheduler } from "../services/transport/scheduler";
import { transportService } from "../services/transport/transport.service";

const transport = new Hono();

// ===== Statistics =====

transport.get("/stats", async (c) => {
  const stats = await transportService.getStats();
  return c.json(stats);
});

// ===== Vessels =====

const vesselsQuerySchema = z.object({
  vesselType: z.string().optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

transport.get(
  "/vessels",
  zValidator("query", vesselsQuerySchema),
  async (c) => {
    const { vesselType, limit = 50, offset = 0 } = c.req.valid("query");

    const vessels = await transportService.getVessels({
      vesselType,
      limit,
      offset,
    });

    return c.json({
      vessels,
      count: vessels.length,
      limit,
      offset,
    });
  }
);

// ===== Aircraft =====

const aircraftQuerySchema = z.object({
  aircraftType: z.string().optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

transport.get(
  "/aircraft",
  zValidator("query", aircraftQuerySchema),
  async (c) => {
    const { aircraftType, limit = 50, offset = 0 } = c.req.valid("query");

    const aircraft = await transportService.getAircraft({
      aircraftType,
      limit,
      offset,
    });

    return c.json({
      aircraft,
      count: aircraft.length,
      limit,
      offset,
    });
  }
);

// ===== Flows =====

const flowsQuerySchema = z.object({
  commodity: z.string().optional(),
  periodType: z.enum(["daily", "weekly", "monthly"]).optional(),
  limit: z.string().transform(Number).optional(),
});

transport.get("/flows", zValidator("query", flowsQuerySchema), async (c) => {
  const { commodity, periodType, limit = 50 } = c.req.valid("query");

  const flows = await transportService.getFlows({
    commodity,
    periodType,
    limit,
  });

  return c.json({
    flows,
    count: flows.length,
  });
});

// ===== Signals =====

const signalsQuerySchema = z.object({
  commodity: z.string().optional(),
  direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
  limit: z.string().transform(Number).optional(),
});

transport.get(
  "/signals",
  zValidator("query", signalsQuerySchema),
  async (c) => {
    const { commodity, direction, limit = 50 } = c.req.valid("query");

    const signals = await transportService.getSignals({
      commodity,
      direction,
      limit,
    });

    return c.json({
      signals,
      count: signals.length,
    });
  }
);

// ===== Region Activity =====

const regionActivityQuerySchema = z.object({
  hoursBack: z.string().transform(Number).optional(),
});

transport.get(
  "/regions/activity",
  zValidator("query", regionActivityQuerySchema),
  async (c) => {
    const { hoursBack = 24 } = c.req.valid("query");

    const activity = await transportService.getRegionActivity(hoursBack);

    return c.json({
      activity,
      hoursBack,
      timestamp: new Date(),
    });
  }
);

// ===== Commodity Volumes =====

const commodityVolumesQuerySchema = z.object({
  daysBack: z.string().transform(Number).optional(),
});

transport.get(
  "/commodities/volumes",
  zValidator("query", commodityVolumesQuerySchema),
  async (c) => {
    const { daysBack = 7 } = c.req.valid("query");

    const volumes = await transportService.getCommodityVolumes(daysBack);

    return c.json({
      volumes,
      daysBack,
      timestamp: new Date(),
    });
  }
);

// ===== Manual Collection =====

const collectBodySchema = z.object({
  source: z.enum(["all", "aircraft", "vessels"]).default("all"),
});

transport.post("/collect", zValidator("json", collectBodySchema), async (c) => {
  const { source } = c.req.valid("json");

  try {
    let result;

    switch (source) {
      case "aircraft":
        result = await transportService.collectAircraft();
        break;
      case "vessels":
        result = await transportService.collectVessels();
        break;
      case "all":
      default:
        result = await transportService.collectAll();
        break;
    }

    return c.json({
      message: `Collection completed from ${source}`,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Collection failed";
    return c.json({ error: message }, 500);
  }
});

// ===== Analyze & Generate Signals =====

transport.post("/analyze", async (c) => {
  try {
    const result = await transportService.analyzeAndGenerateSignals();

    return c.json({
      message: "Analysis completed",
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return c.json({ error: message }, 500);
  }
});

// ===== Overview =====

transport.get("/overview", async (c) => {
  const [stats, signals, activity, volumes] = await Promise.all([
    transportService.getStats(),
    transportService.getSignals({ limit: 10 }),
    transportService.getRegionActivity(24),
    transportService.getCommodityVolumes(7),
  ]);

  return c.json({
    stats,
    topSignals: signals,
    topRegions: activity.slice(0, 5),
    commodityVolumes: volumes,
    lastUpdated: new Date(),
  });
});

// ===== Available Vessel Types =====

transport.get("/vessel-types", async (c) => {
  const vesselTypes = [
    {
      id: "tanker_crude",
      name: "Crude Oil Tanker",
      commodities: ["crude_oil", "brent"],
    },
    {
      id: "tanker_product",
      name: "Product Tanker",
      commodities: ["crude_oil"],
    },
    { id: "tanker_chemical", name: "Chemical Tanker", commodities: ["other"] },
    {
      id: "tanker_lng",
      name: "LNG Tanker",
      commodities: ["lng", "natural_gas"],
    },
    {
      id: "tanker_lpg",
      name: "LPG Tanker",
      commodities: ["lpg", "natural_gas"],
    },
    {
      id: "bulk_carrier",
      name: "Bulk Carrier",
      commodities: ["wheat", "corn", "soybeans", "rice", "coal"],
    },
    {
      id: "container",
      name: "Container Ship",
      commodities: ["container_freight"],
    },
    {
      id: "ore_carrier",
      name: "Ore Carrier",
      commodities: ["iron_ore", "copper", "aluminum"],
    },
    { id: "general_cargo", name: "General Cargo", commodities: ["other"] },
    { id: "ro_ro", name: "Ro-Ro", commodities: ["other"] },
    { id: "passenger", name: "Passenger", commodities: [] },
    { id: "fishing", name: "Fishing", commodities: [] },
    { id: "tug", name: "Tug", commodities: [] },
    { id: "other", name: "Other", commodities: [] },
  ];

  return c.json({ vesselTypes });
});

// ===== Available Aircraft Types =====

transport.get("/aircraft-types", async (c) => {
  const aircraftTypes = [
    {
      id: "cargo",
      name: "Cargo Aircraft",
      description: "Freight planes (FedEx, UPS, etc.)",
    },
    {
      id: "passenger",
      name: "Passenger Aircraft",
      description: "Commercial airlines",
    },
    {
      id: "private_jet",
      name: "Private Jet",
      description: "Business jets (M&A signal)",
    },
    { id: "helicopter", name: "Helicopter", description: "Rotorcraft" },
    { id: "military", name: "Military", description: "Military aircraft" },
    { id: "other", name: "Other", description: "Other aircraft types" },
  ];

  return c.json({ aircraftTypes });
});

// ===== Available Commodities =====

transport.get("/commodities", async (c) => {
  const commodities = [
    { id: "crude_oil", name: "Crude Oil (WTI)", tickers: ["CL", "USO"] },
    { id: "brent", name: "Brent Crude", tickers: ["BZ", "BNO"] },
    { id: "natural_gas", name: "Natural Gas", tickers: ["NG", "UNG"] },
    { id: "lng", name: "LNG", tickers: ["LNG"] },
    { id: "lpg", name: "LPG", tickers: ["LPG"] },
    { id: "wheat", name: "Wheat", tickers: ["ZW", "WEAT"] },
    { id: "corn", name: "Corn", tickers: ["ZC", "CORN"] },
    { id: "soybeans", name: "Soybeans", tickers: ["ZS", "SOYB"] },
    { id: "rice", name: "Rice", tickers: ["ZR"] },
    { id: "copper", name: "Copper", tickers: ["HG", "CPER"] },
    { id: "aluminum", name: "Aluminum", tickers: ["ALI"] },
    { id: "iron_ore", name: "Iron Ore", tickers: ["IRON"] },
    { id: "coal", name: "Coal", tickers: ["COAL"] },
    {
      id: "container_freight",
      name: "Container Freight",
      tickers: ["BDRY", "SBLK"],
    },
  ];

  return c.json({ commodities });
});

// ===== Major Shipping Regions =====

transport.get("/regions", async (c) => {
  const regions = [
    { name: "Persian Gulf", description: "Major oil export region" },
    { name: "US Gulf", description: "US oil and grain exports" },
    { name: "North Sea", description: "Brent crude origin" },
    { name: "Mediterranean", description: "European import hub" },
    { name: "South China Sea", description: "Major Asian shipping lane" },
    { name: "Singapore Strait", description: "Critical chokepoint" },
    { name: "Suez Canal", description: "Europe-Asia route" },
    { name: "Panama Canal", description: "Atlantic-Pacific route" },
    { name: "Black Sea", description: "Grain export region" },
    { name: "Baltic Sea", description: "European trade" },
    { name: "West Africa", description: "Oil exports" },
    { name: "Brazil", description: "Iron ore and grains" },
  ];

  return c.json({ regions });
});

// ===== Scheduler Control =====

transport.post("/scheduler/start", async (c) => {
  transportScheduler.start();
  return c.json({
    message: "Transport scheduler started",
    status: transportScheduler.getStatus(),
  });
});

transport.post("/scheduler/stop", async (c) => {
  transportScheduler.stop();
  return c.json({
    message: "Transport scheduler stopped",
    status: transportScheduler.getStatus(),
  });
});

transport.get("/scheduler/status", async (c) => {
  return c.json(transportScheduler.getStatus());
});

transport.post("/scheduler/collect-now", async (c) => {
  try {
    const result = await transportScheduler.collectNow();
    return c.json({
      message: "Manual collection completed",
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Collection failed";
    return c.json({ error: message }, 500);
  }
});

transport.post("/scheduler/analyze-now", async (c) => {
  try {
    const result = await transportScheduler.analyzeNow();
    return c.json({
      message: "Manual analysis completed",
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return c.json({ error: message }, 500);
  }
});

export default transport;
