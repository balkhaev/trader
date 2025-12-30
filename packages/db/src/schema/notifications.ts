import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// Notification settings for users
export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // Telegram settings
    telegramChatId: text("telegram_chat_id"),
    telegramEnabled: boolean("telegram_enabled").default(false).notNull(),
    // Email settings
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    // Notification types
    notifyNewSignals: boolean("notify_new_signals").default(true).notNull(),
    notifyTradeOpened: boolean("notify_trade_opened").default(true).notNull(),
    notifyTradeClosed: boolean("notify_trade_closed").default(true).notNull(),
    notifyTrendAlerts: boolean("notify_trend_alerts").default(false).notNull(),
    notifyTransportSignals: boolean("notify_transport_signals")
      .default(false)
      .notNull(),
    // Thresholds
    minSignalStrength: text("min_signal_strength").default("50"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("notification_settings_user_idx").on(table.userId)]
);

// Relations
export const notificationSettingsRelations = relations(
  notificationSettings,
  ({ one }) => ({
    user: one(user, {
      fields: [notificationSettings.userId],
      references: [user.id],
    }),
  })
);
