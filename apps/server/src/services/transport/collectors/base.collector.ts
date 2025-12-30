import {
  db,
  transportAircraft,
  transportPosition,
  transportVessel,
} from "@trader/db";
import { eq } from "drizzle-orm";
import type {
  AircraftInfo,
  Position,
  TransportCollectResult,
  TransportSource,
  VesselInfo,
} from "../types";

export abstract class BaseTransportCollector {
  abstract readonly name: string;
  abstract readonly source: TransportSource;

  /**
   * Collect data from the external source
   */
  abstract collect(): Promise<TransportCollectResult>;

  /**
   * Upsert a vessel into the database
   */
  async upsertVessel(info: VesselInfo): Promise<string> {
    const existing = await db
      .select({ id: transportVessel.id })
      .from(transportVessel)
      .where(eq(transportVessel.mmsi, info.mmsi))
      .limit(1);

    const existingVessel = existing[0];
    if (existingVessel) {
      const vesselId = existingVessel.id;
      await db
        .update(transportVessel)
        .set({
          name: info.name,
          callsign: info.callsign,
          vesselType: info.vesselType,
          flag: info.flag,
          length: info.length ? String(info.length) : null,
          width: info.width ? String(info.width) : null,
          deadweight: info.deadweight ? String(info.deadweight) : null,
          metadata: info.metadata,
          updatedAt: new Date(),
        })
        .where(eq(transportVessel.id, vesselId));

      return vesselId;
    }

    const insertedVessels = await db
      .insert(transportVessel)
      .values({
        mmsi: info.mmsi,
        imo: info.imo,
        name: info.name,
        callsign: info.callsign,
        vesselType: info.vesselType,
        flag: info.flag,
        length: info.length ? String(info.length) : null,
        width: info.width ? String(info.width) : null,
        deadweight: info.deadweight ? String(info.deadweight) : null,
        source: info.source,
        metadata: info.metadata,
      })
      .returning({ id: transportVessel.id });

    const newVessel = insertedVessels[0];
    if (!newVessel) {
      throw new Error("Failed to insert vessel");
    }
    return newVessel.id;
  }

  /**
   * Upsert an aircraft into the database
   */
  async upsertAircraft(info: AircraftInfo): Promise<string> {
    const existing = await db
      .select({ id: transportAircraft.id })
      .from(transportAircraft)
      .where(eq(transportAircraft.icao24, info.icao24))
      .limit(1);

    const existingAircraft = existing[0];
    if (existingAircraft) {
      const aircraftId = existingAircraft.id;
      await db
        .update(transportAircraft)
        .set({
          callsign: info.callsign,
          aircraftType: info.aircraftType,
          model: info.model,
          manufacturer: info.manufacturer,
          operator: info.operator,
          country: info.country,
          metadata: info.metadata,
          updatedAt: new Date(),
        })
        .where(eq(transportAircraft.id, aircraftId));

      return aircraftId;
    }

    const insertedAircraft = await db
      .insert(transportAircraft)
      .values({
        icao24: info.icao24,
        registration: info.registration,
        callsign: info.callsign,
        aircraftType: info.aircraftType,
        model: info.model,
        manufacturer: info.manufacturer,
        operator: info.operator,
        country: info.country,
        source: info.source,
        metadata: info.metadata,
      })
      .returning({ id: transportAircraft.id });

    const newAircraft = insertedAircraft[0];
    if (!newAircraft) {
      throw new Error("Failed to insert aircraft");
    }
    return newAircraft.id;
  }

  /**
   * Record a position for a vessel
   */
  async recordVesselPosition(
    vesselId: string,
    position: Position
  ): Promise<void> {
    await db.insert(transportPosition).values({
      vesselId,
      aircraftId: null,
      latitude: position.latitude,
      longitude: position.longitude,
      altitude: null,
      speed: position.speed,
      heading: position.heading,
      course: position.course,
      timestamp: position.timestamp,
      source: this.source,
    });
  }

  /**
   * Record a position for an aircraft
   */
  async recordAircraftPosition(
    aircraftId: string,
    position: Position
  ): Promise<void> {
    await db.insert(transportPosition).values({
      vesselId: null,
      aircraftId,
      latitude: position.latitude,
      longitude: position.longitude,
      altitude: position.altitude,
      speed: position.speed,
      heading: position.heading,
      course: position.course,
      timestamp: position.timestamp,
      source: this.source,
    });
  }

  /**
   * Get vessel by MMSI
   */
  async getVesselByMmsi(mmsi: string): Promise<{ id: string } | null> {
    const [vessel] = await db
      .select({ id: transportVessel.id })
      .from(transportVessel)
      .where(eq(transportVessel.mmsi, mmsi))
      .limit(1);

    return vessel || null;
  }

  /**
   * Get aircraft by ICAO24
   */
  async getAircraftByIcao24(icao24: string): Promise<{ id: string } | null> {
    const [aircraft] = await db
      .select({ id: transportAircraft.id })
      .from(transportAircraft)
      .where(eq(transportAircraft.icao24, icao24))
      .limit(1);

    return aircraft || null;
  }

  /**
   * Helper: delay between API calls
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Helper: log info
   */
  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  /**
   * Helper: log error
   */
  protected logError(message: string, error?: Error): void {
    console.error(`[${this.name}] ERROR: ${message}`, error?.message || "");
  }
}
