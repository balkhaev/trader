import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { db, notificationSettings } from "@trader/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { telegramService } from "../services/notifications";

const notifications = new Hono();

// Helper to get user
async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

// GET /api/notifications/settings - get user's notification settings
notifications.get("/settings", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, user.id));

  if (!settings) {
    // Return default settings
    return c.json({
      telegramChatId: null,
      telegramEnabled: false,
      emailEnabled: true,
      notifyNewSignals: true,
      notifyTradeOpened: true,
      notifyTradeClosed: true,
      notifyTrendAlerts: false,
      notifyTransportSignals: false,
      minSignalStrength: "50",
    });
  }

  return c.json({
    telegramChatId: settings.telegramChatId,
    telegramEnabled: settings.telegramEnabled,
    emailEnabled: settings.emailEnabled,
    notifyNewSignals: settings.notifyNewSignals,
    notifyTradeOpened: settings.notifyTradeOpened,
    notifyTradeClosed: settings.notifyTradeClosed,
    notifyTrendAlerts: settings.notifyTrendAlerts,
    notifyTransportSignals: settings.notifyTransportSignals,
    minSignalStrength: settings.minSignalStrength,
  });
});

// PUT /api/notifications/settings - update notification settings
const updateSettingsSchema = z.object({
  telegramChatId: z.string().nullable().optional(),
  telegramEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  notifyNewSignals: z.boolean().optional(),
  notifyTradeOpened: z.boolean().optional(),
  notifyTradeClosed: z.boolean().optional(),
  notifyTrendAlerts: z.boolean().optional(),
  notifyTransportSignals: z.boolean().optional(),
  minSignalStrength: z.string().optional(),
});

notifications.put(
  "/settings",
  zValidator("json", updateSettingsSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const updates = c.req.valid("json");

    // Check if settings exist
    const [existing] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, user.id));

    if (existing) {
      // Update existing settings
      const [updated] = await db
        .update(notificationSettings)
        .set(updates)
        .where(eq(notificationSettings.userId, user.id))
        .returning();

      return c.json({ success: true, settings: updated });
    }
    // Create new settings
    const [created] = await db
      .insert(notificationSettings)
      .values({
        userId: user.id,
        ...updates,
      })
      .returning();

    return c.json({ success: true, settings: created });
  }
);

// POST /api/notifications/test-telegram - send a test message
notifications.post("/test-telegram", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!telegramService.isConfigured()) {
    return c.json({ error: "Telegram not configured on server" }, 400);
  }

  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, user.id));

  if (!settings?.telegramChatId) {
    return c.json({ error: "Telegram chat ID not set" }, 400);
  }

  const success = await telegramService.sendToChat(
    settings.telegramChatId,
    "🔔 <b>Test Notification</b>\n\nYour Trader notifications are working!"
  );

  if (success) {
    return c.json({ success: true, message: "Test message sent" });
  }
  return c.json({ error: "Failed to send test message" }, 500);
});

// GET /api/notifications/telegram-status - check telegram configuration
notifications.get("/telegram-status", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const serverConfigured = telegramService.isConfigured();

  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, user.id));

  return c.json({
    serverConfigured,
    userChatId: settings?.telegramChatId || null,
    enabled: settings?.telegramEnabled,
    ready:
      serverConfigured &&
      !!settings?.telegramChatId &&
      settings?.telegramEnabled,
  });
});

export default notifications;
