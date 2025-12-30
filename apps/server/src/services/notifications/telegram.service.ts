import { db } from "@trader/db";
import { eq } from "drizzle-orm";

interface TelegramMessage {
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

interface SignalNotification {
  symbol: string;
  side: "long" | "short";
  strength: number;
  reasoning?: string;
  source: string;
}

interface TrendAlertNotification {
  tagName: string;
  changeType: "spike" | "drop" | "new_entity";
  changePercent: number;
  description?: string;
}

interface TradeClosedNotification {
  symbol: string;
  side: "long" | "short";
  entryPrice: string;
  exitPrice: string;
  pnlPercent: number;
  isWin: boolean;
}

class TelegramService {
  private botToken: string | null = null;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || null;
  }

  isConfigured(): boolean {
    return !!this.botToken;
  }

  private async sendMessage(message: TelegramMessage): Promise<boolean> {
    if (!this.botToken) {
      console.log("[TelegramService] Bot token not configured");
      return false;
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.chatId,
            text: message.text,
            parse_mode: message.parseMode || "HTML",
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        console.error("[TelegramService] Send failed:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("[TelegramService] Error sending message:", error);
      return false;
    }
  }

  // Get user's notification settings
  private async getUserSettings(userId: string) {
    const [settings] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));

    return settings || null;
  }

  // Get user's telegram chat ID from their settings
  private async getUserChatId(userId: string): Promise<string | null> {
    const settings = await this.getUserSettings(userId);
    if (!(settings?.telegramEnabled && settings?.telegramChatId)) {
      return null;
    }
    return settings.telegramChatId;
  }

  // Check if user should receive a specific notification type
  private async shouldNotify(
    userId: string,
    type: "signal" | "tradeOpened" | "tradeClosed" | "trend" | "transport"
  ): Promise<{
    shouldSend: boolean;
    chatId: string | null;
    minStrength?: number;
  }> {
    const settings = await this.getUserSettings(userId);

    if (!(settings?.telegramEnabled && settings?.telegramChatId)) {
      return { shouldSend: false, chatId: null };
    }

    let shouldSend = false;
    switch (type) {
      case "signal":
        shouldSend = settings.notifyNewSignals;
        break;
      case "tradeOpened":
        shouldSend = settings.notifyTradeOpened;
        break;
      case "tradeClosed":
        shouldSend = settings.notifyTradeClosed;
        break;
      case "trend":
        shouldSend = settings.notifyTrendAlerts;
        break;
      case "transport":
        shouldSend = settings.notifyTransportSignals;
        break;
    }

    return {
      shouldSend,
      chatId: settings.telegramChatId,
      minStrength: settings.minSignalStrength
        ? Number.parseFloat(settings.minSignalStrength)
        : 50,
    };
  }

  async notifyNewSignal(
    userId: string,
    signal: SignalNotification
  ): Promise<boolean> {
    const { shouldSend, chatId, minStrength } = await this.shouldNotify(
      userId,
      "signal"
    );

    if (!(shouldSend && chatId)) {
      return false;
    }

    // Check minimum strength threshold
    if (minStrength && signal.strength < minStrength) {
      console.log(
        `[TelegramService] Signal strength ${signal.strength} below threshold ${minStrength}`
      );
      return false;
    }

    const emoji = signal.side === "long" ? "📈" : "📉";
    const strengthBar =
      "▓".repeat(Math.floor(signal.strength / 10)) +
      "░".repeat(10 - Math.floor(signal.strength / 10));

    const text = `
${emoji} <b>New Trading Signal</b>

<b>Symbol:</b> ${signal.symbol}
<b>Direction:</b> ${signal.side.toUpperCase()}
<b>Strength:</b> ${strengthBar} ${signal.strength}%
<b>Source:</b> ${signal.source}

${signal.reasoning ? `<i>${signal.reasoning}</i>` : ""}

<a href="${process.env.CORS_ORIGIN || "http://localhost:3001"}/signals">View in Dashboard</a>
    `.trim();

    return this.sendMessage({ chatId, text });
  }

  async notifyTradeOpened(
    userId: string,
    data: { symbol: string; side: "long" | "short"; entryPrice: string }
  ): Promise<boolean> {
    const { shouldSend, chatId } = await this.shouldNotify(
      userId,
      "tradeOpened"
    );
    if (!(shouldSend && chatId)) return false;

    const emoji = data.side === "long" ? "🟢" : "🔴";

    const text = `
${emoji} <b>Trade Opened</b>

<b>Symbol:</b> ${data.symbol}
<b>Direction:</b> ${data.side.toUpperCase()}
<b>Entry Price:</b> $${data.entryPrice}
    `.trim();

    return this.sendMessage({ chatId, text });
  }

  async notifyTradeClosed(
    userId: string,
    data: TradeClosedNotification
  ): Promise<boolean> {
    const { shouldSend, chatId } = await this.shouldNotify(
      userId,
      "tradeClosed"
    );
    if (!(shouldSend && chatId)) return false;

    const emoji = data.isWin ? "✅" : "❌";
    const pnlEmoji = data.pnlPercent >= 0 ? "💰" : "💸";

    const text = `
${emoji} <b>Trade Closed</b>

<b>Symbol:</b> ${data.symbol}
<b>Direction:</b> ${data.side.toUpperCase()}
<b>Entry:</b> $${data.entryPrice}
<b>Exit:</b> $${data.exitPrice}
${pnlEmoji} <b>P&L:</b> ${data.pnlPercent >= 0 ? "+" : ""}${data.pnlPercent.toFixed(2)}%

${data.isWin ? "🎉 Winner!" : "📊 Better luck next time!"}
    `.trim();

    return this.sendMessage({ chatId, text });
  }

  async notifyTrendAlert(
    userId: string,
    alert: TrendAlertNotification
  ): Promise<boolean> {
    const { shouldSend, chatId } = await this.shouldNotify(userId, "trend");
    if (!(shouldSend && chatId)) return false;

    const emoji =
      alert.changeType === "spike"
        ? "🔥"
        : alert.changeType === "drop"
          ? "📉"
          : "🆕";

    const changeText =
      alert.changeType === "new_entity"
        ? "New entity detected"
        : `${alert.changePercent >= 0 ? "+" : ""}${alert.changePercent.toFixed(0)}% mentions`;

    const text = `
${emoji} <b>Trend Alert: ${alert.tagName}</b>

${changeText}
${alert.description ? `<i>${alert.description}</i>` : ""}

<a href="${process.env.CORS_ORIGIN || "http://localhost:3001"}/trends">View Trends</a>
    `.trim();

    return this.sendMessage({ chatId, text });
  }

  async sendCustomMessage(userId: string, message: string): Promise<boolean> {
    const chatId = await this.getUserChatId(userId);
    if (!chatId) return false;

    return this.sendMessage({ chatId, text: message });
  }

  // Send to a specific chat ID (for admin notifications)
  async sendToChat(chatId: string, message: string): Promise<boolean> {
    return this.sendMessage({ chatId, text: message });
  }

  // Broadcast to all users with telegram configured
  async broadcast(message: string): Promise<number> {
    // This would need to query all users with telegramChatId set
    // For now, just log
    console.log("[TelegramService] Broadcast not implemented:", message);
    return 0;
  }
}

export const telegramService = new TelegramService();
