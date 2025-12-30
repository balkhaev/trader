import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const backtestStatusEnum = pgEnum("backtest_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const backtest = pgTable(
  "backtest",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    strategyName: text("strategy_name").notNull(),
    status: backtestStatusEnum("status").default("pending").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    resultsPath: text("results_path"),
    config: jsonb("config").$type<{
      startDate?: string;
      endDate?: string;
      cash?: number;
    }>(),
    statistics: jsonb("statistics").$type<Record<string, string>>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("backtest_userId_idx").on(table.userId),
    index("backtest_status_idx").on(table.status),
    index("backtest_strategyName_idx").on(table.strategyName),
  ]
);

export const backtestRelations = relations(backtest, ({ one }) => ({
  user: one(user, {
    fields: [backtest.userId],
    references: [user.id],
  }),
}));
