import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const marketCategoryEnum = pgEnum("market_category", ["spot", "linear"]);

export const dataImport = pgTable(
  "data_import",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exchange: text("exchange").notNull(), // bybit, binance, etc.
    symbol: text("symbol").notNull(),
    category: marketCategoryEnum("category").notNull(),
    interval: text("interval").notNull(), // "1", "D", etc.
    status: importStatusEnum("status").default("pending").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    totalRecords: integer("total_records").default(0).notNull(),
    filePath: text("file_path"),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("data_import_userId_idx").on(table.userId),
    index("data_import_status_idx").on(table.status),
    index("data_import_exchange_idx").on(table.exchange),
    index("data_import_symbol_idx").on(table.symbol),
  ]
);

export const dataImportRelations = relations(dataImport, ({ one }) => ({
  user: one(user, {
    fields: [dataImport.userId],
    references: [user.id],
  }),
}));
