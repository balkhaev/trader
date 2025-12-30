import type { SQL } from "drizzle-orm";
import { asc, desc } from "drizzle-orm";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import { db } from "../db";

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SortParams<T> {
  field: keyof T;
  direction: "asc" | "desc";
}

export abstract class BaseRepository<TTable extends PgTable<TableConfig>> {
  protected db = db;

  constructor(protected table: TTable) {}

  /**
   * Paginate query results
   */
  protected async paginate<T>(
    query: Promise<T[]>,
    countQuery: Promise<{ count: number }[]>,
    pagination: PaginationParams
  ): Promise<PaginatedResult<T>> {
    const { limit = 50, offset = 0 } = pagination;

    const [data, countResult] = await Promise.all([query, countQuery]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Build order by clause
   */
  protected getOrderBy<TColumn>(
    column: TColumn,
    direction: "asc" | "desc" = "desc"
  ) {
    return direction === "asc" ? asc(column as SQL) : desc(column as SQL);
  }
}
