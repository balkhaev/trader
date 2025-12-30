import { agentRepository } from "@trader/db";
import { logger } from "../../lib/logger";
import { presetAgents } from "./presets";

/**
 * Seeds the database with preset agents
 * Safe to run multiple times - will skip existing agents
 */
export async function seedAgents(): Promise<{
  created: string[];
  skipped: string[];
}> {
  const log = logger.child("agent-seed");
  const created: string[] = [];
  const skipped: string[] = [];

  for (const agentData of presetAgents) {
    try {
      // Check if agent already exists
      const existing = await agentRepository.findBySlug(agentData.slug!);

      if (existing) {
        log.debug("Agent already exists, skipping", { slug: agentData.slug });
        skipped.push(agentData.slug!);
        continue;
      }

      // Create the agent
      const agent = await agentRepository.create(agentData);

      log.info("Agent created", {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
      });

      created.push(agentData.slug!);
    } catch (error) {
      log.error("Failed to create agent", {
        slug: agentData.slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (created.length > 0) {
    log.info("Agents seeded", { created: created.length });
  }

  return { created, skipped };
}

export default seedAgents;
