import { db, newsTag, tagRelation } from "@trader/db";
import { and, eq, gte, or, sql } from "drizzle-orm";

interface PathNode {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
}

interface PathEdge {
  sourceId: string;
  targetId: string;
  type: string;
  weight: number;
}

interface Path {
  nodes: PathNode[];
  edges: PathEdge[];
  totalWeight: number;
  depth: number;
}

interface FindPathOptions {
  maxDepth?: number;
  minStrength?: number;
  findAll?: boolean;
  maxPaths?: number;
}

export const pathFinderService = {
  /**
   * Find shortest path between two nodes using BFS
   */
  async findShortestPath(
    fromId: string,
    toId: string,
    options: FindPathOptions = {}
  ): Promise<Path | null> {
    const { maxDepth = 5, minStrength = 0.01 } = options;

    // Get adjacency list
    const adjacency = await this.buildAdjacencyList(minStrength);

    if (!(adjacency.has(fromId) && adjacency.has(toId))) {
      return null;
    }

    // BFS
    const queue: { nodeId: string; path: string[]; edges: PathEdge[] }[] = [
      { nodeId: fromId, path: [fromId], edges: [] },
    ];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length > maxDepth + 1) {
        continue;
      }

      const neighbors = adjacency.get(current.nodeId) || [];

      for (const neighbor of neighbors) {
        if (neighbor.targetId === toId) {
          // Found path
          const pathNodeIds = [...current.path, toId];
          const pathEdges = [...current.edges, neighbor];

          const nodes = await this.getNodesByIds(pathNodeIds);
          const totalWeight = pathEdges.reduce((sum, e) => sum + e.weight, 0);

          return {
            nodes,
            edges: pathEdges,
            totalWeight,
            depth: pathNodeIds.length - 1,
          };
        }

        if (!visited.has(neighbor.targetId)) {
          visited.add(neighbor.targetId);
          queue.push({
            nodeId: neighbor.targetId,
            path: [...current.path, neighbor.targetId],
            edges: [...current.edges, neighbor],
          });
        }
      }
    }

    return null;
  },

  /**
   * Find all paths between two nodes up to maxDepth (using DFS)
   */
  async findAllPaths(
    fromId: string,
    toId: string,
    options: FindPathOptions = {}
  ): Promise<Path[]> {
    const { maxDepth = 4, minStrength = 0.01, maxPaths = 10 } = options;

    const adjacency = await this.buildAdjacencyList(minStrength);

    if (!(adjacency.has(fromId) && adjacency.has(toId))) {
      return [];
    }

    const paths: Path[] = [];
    const visited = new Set<string>();

    const dfs = async (
      nodeId: string,
      path: string[],
      edges: PathEdge[]
    ): Promise<void> => {
      if (paths.length >= maxPaths) return;
      if (path.length > maxDepth + 1) return;

      if (nodeId === toId) {
        const nodes = await this.getNodesByIds(path);
        const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);
        paths.push({
          nodes,
          edges,
          totalWeight,
          depth: path.length - 1,
        });
        return;
      }

      visited.add(nodeId);
      const neighbors = adjacency.get(nodeId) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.targetId)) {
          await dfs(
            neighbor.targetId,
            [...path, neighbor.targetId],
            [...edges, neighbor]
          );
        }
      }

      visited.delete(nodeId);
    };

    await dfs(fromId, [fromId], []);

    // Sort by total weight (stronger connections first)
    paths.sort((a, b) => b.totalWeight - a.totalWeight);

    return paths;
  },

  /**
   * Find weighted shortest path using Dijkstra's algorithm
   * Weight is inverted (1 - strength) so stronger connections = shorter path
   */
  async findWeightedPath(
    fromId: string,
    toId: string,
    options: FindPathOptions = {}
  ): Promise<Path | null> {
    const { maxDepth = 6, minStrength = 0.01 } = options;

    const adjacency = await this.buildAdjacencyList(minStrength);

    if (!(adjacency.has(fromId) && adjacency.has(toId))) {
      return null;
    }

    // Dijkstra
    const distances = new Map<string, number>();
    const previous = new Map<
      string,
      { nodeId: string; edge: PathEdge } | null
    >();
    const unvisited = new Set<string>(adjacency.keys());

    distances.set(fromId, 0);
    previous.set(fromId, null);

    while (unvisited.size > 0) {
      // Find node with minimum distance
      let currentId: string | null = null;
      let minDist = Number.POSITIVE_INFINITY;

      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
        if (dist < minDist) {
          minDist = dist;
          currentId = nodeId;
        }
      }

      if (currentId === null || minDist === Number.POSITIVE_INFINITY) break;
      if (currentId === toId) break;

      unvisited.delete(currentId);

      const neighbors = adjacency.get(currentId) || [];
      const currentDist = distances.get(currentId)!;
      const currentDepth = this.countDepth(previous, currentId);

      if (currentDepth >= maxDepth) continue;

      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor.targetId)) continue;

        // Invert weight: stronger connection = shorter distance
        const edgeDistance = 1 - neighbor.weight;
        const newDist = currentDist + edgeDistance;

        const existingDist =
          distances.get(neighbor.targetId) ?? Number.POSITIVE_INFINITY;
        if (newDist < existingDist) {
          distances.set(neighbor.targetId, newDist);
          previous.set(neighbor.targetId, {
            nodeId: currentId,
            edge: neighbor,
          });
        }
      }
    }

    // Reconstruct path
    if (!previous.has(toId)) return null;

    const pathNodeIds: string[] = [];
    const pathEdges: PathEdge[] = [];
    let current = toId;

    while (current !== fromId) {
      pathNodeIds.unshift(current);
      const prev = previous.get(current);
      if (!prev) break;
      pathEdges.unshift(prev.edge);
      current = prev.nodeId;
    }
    pathNodeIds.unshift(fromId);

    const nodes = await this.getNodesByIds(pathNodeIds);
    const totalWeight = pathEdges.reduce((sum, e) => sum + e.weight, 0);

    return {
      nodes,
      edges: pathEdges,
      totalWeight,
      depth: pathNodeIds.length - 1,
    };
  },

  /**
   * Get common neighbors between two nodes
   */
  async findCommonNeighbors(
    nodeId1: string,
    nodeId2: string,
    minStrength = 0.1
  ): Promise<PathNode[]> {
    const result = await db.execute(sql`
      WITH neighbors1 AS (
        SELECT 
          CASE 
            WHEN source_tag_id = ${nodeId1} THEN target_tag_id
            ELSE source_tag_id
          END as neighbor_id
        FROM tag_relation
        WHERE (source_tag_id = ${nodeId1} OR target_tag_id = ${nodeId1})
          AND strength::numeric >= ${minStrength}
      ),
      neighbors2 AS (
        SELECT 
          CASE 
            WHEN source_tag_id = ${nodeId2} THEN target_tag_id
            ELSE source_tag_id
          END as neighbor_id
        FROM tag_relation
        WHERE (source_tag_id = ${nodeId2} OR target_tag_id = ${nodeId2})
          AND strength::numeric >= ${minStrength}
      )
      SELECT DISTINCT nt.id, nt.name, nt.type, nt.subtype
      FROM neighbors1 n1
      INNER JOIN neighbors2 n2 ON n1.neighbor_id = n2.neighbor_id
      INNER JOIN news_tag nt ON nt.id = n1.neighbor_id
      WHERE n1.neighbor_id NOT IN (${nodeId1}, ${nodeId2})
    `);

    return (
      result.rows as Array<{
        id: string;
        name: string;
        type: string;
        subtype: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      subtype: r.subtype,
    }));
  },

  /**
   * Get relationship types between two nodes (direct and through intermediaries)
   */
  async analyzeRelationship(
    nodeId1: string,
    nodeId2: string
  ): Promise<{
    directConnection: PathEdge | null;
    shortestPath: Path | null;
    commonNeighbors: PathNode[];
    connectionStrength: number;
  }> {
    // Check direct connection
    const directRelation = await db
      .select({
        sourceTagId: tagRelation.sourceTagId,
        targetTagId: tagRelation.targetTagId,
        relationType: tagRelation.relationType,
        strength: tagRelation.strength,
      })
      .from(tagRelation)
      .where(
        or(
          and(
            eq(tagRelation.sourceTagId, nodeId1),
            eq(tagRelation.targetTagId, nodeId2)
          ),
          and(
            eq(tagRelation.sourceTagId, nodeId2),
            eq(tagRelation.targetTagId, nodeId1)
          )
        )
      )
      .limit(1);

    const directConnection = directRelation[0]
      ? {
          sourceId: directRelation[0].sourceTagId,
          targetId: directRelation[0].targetTagId,
          type: directRelation[0].relationType,
          weight: Number(directRelation[0].strength) || 0,
        }
      : null;

    // Find shortest path
    const shortestPath = await this.findShortestPath(nodeId1, nodeId2, {
      maxDepth: 4,
    });

    // Find common neighbors
    const commonNeighbors = await this.findCommonNeighbors(nodeId1, nodeId2);

    // Calculate connection strength
    let connectionStrength = 0;
    if (directConnection) {
      connectionStrength = directConnection.weight;
    } else if (shortestPath) {
      // Average weight of path edges, discounted by depth
      const avgWeight = shortestPath.totalWeight / shortestPath.edges.length;
      connectionStrength = avgWeight * 0.8 ** (shortestPath.depth - 1);
    } else if (commonNeighbors.length > 0) {
      connectionStrength = 0.1 * Math.min(1, commonNeighbors.length / 5);
    }

    return {
      directConnection,
      shortestPath,
      commonNeighbors,
      connectionStrength,
    };
  },

  // Helper methods

  async buildAdjacencyList(
    minStrength: number
  ): Promise<Map<string, PathEdge[]>> {
    const relations = await db
      .select({
        sourceTagId: tagRelation.sourceTagId,
        targetTagId: tagRelation.targetTagId,
        relationType: tagRelation.relationType,
        strength: tagRelation.strength,
      })
      .from(tagRelation)
      .where(gte(sql`${tagRelation.strength}::numeric`, minStrength));

    const adjacency = new Map<string, PathEdge[]>();

    for (const rel of relations) {
      const weight = Number(rel.strength) || 0;
      const edge: PathEdge = {
        sourceId: rel.sourceTagId,
        targetId: rel.targetTagId,
        type: rel.relationType,
        weight,
      };
      const reverseEdge: PathEdge = {
        sourceId: rel.targetTagId,
        targetId: rel.sourceTagId,
        type: rel.relationType,
        weight,
      };

      if (!adjacency.has(rel.sourceTagId)) {
        adjacency.set(rel.sourceTagId, []);
      }
      adjacency.get(rel.sourceTagId)!.push(edge);

      if (!adjacency.has(rel.targetTagId)) {
        adjacency.set(rel.targetTagId, []);
      }
      adjacency.get(rel.targetTagId)!.push(reverseEdge);
    }

    return adjacency;
  },

  async getNodesByIds(ids: string[]): Promise<PathNode[]> {
    if (ids.length === 0) return [];

    const nodes = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        subtype: newsTag.subtype,
      })
      .from(newsTag)
      .where(
        sql`${newsTag.id} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})`
      );

    // Preserve order
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return ids.map((id) => nodeMap.get(id)!).filter(Boolean);
  },

  countDepth(
    previous: Map<string, { nodeId: string; edge: PathEdge } | null>,
    nodeId: string
  ): number {
    let depth = 0;
    let current = nodeId;
    while (previous.get(current) !== null) {
      const prev = previous.get(current);
      if (!prev) break;
      current = prev.nodeId;
      depth++;
    }
    return depth;
  },
};
