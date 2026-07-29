import { db, notificationSettings } from "@trader/db";
import { eq } from "drizzle-orm";

interface TradeOpenedNotification {
  symbol: string;
  side: "long" | "short";
  entryPrice: string;
}

interface TradeClosedNotification extends TradeOpenedNotification {
  exitPrice: string;
  pnlPercent: number;
  isWin: boolean;
}

class TelegramService {
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN || null;

  private async chatId(userId: string): Promise<string | null> {
    if (!this.botToken) return null;
    const [settings] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    return settings?.telegramEnabled ? settings.telegramChatId : null;
  }

  private async send(userId: string, text: string): Promise<boolean> {
    const chatId = await this.chatId(userId);
    if (!(chatId && this.botToken)) return false;
    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      }
    );
    return response.ok;
  }

  async notifyTradeOpened(
    userId: string,
    trade: TradeOpenedNotification
  ): Promise<boolean> {
    return this.send(
      userId,
      `<b>Consensus position opened</b>\n${trade.symbol} ${trade.side.toUpperCase()}\nEntry: ${trade.entryPrice}`
    );
  }

  async notifyTradeClosed(
    userId: string,
    trade: TradeClosedNotification
  ): Promise<boolean> {
    return this.send(
      userId,
      `<b>Consensus position closed</b>\n${trade.symbol} ${trade.side.toUpperCase()}\n${trade.entryPrice} → ${trade.exitPrice}\nP&L: ${trade.pnlPercent >= 0 ? "+" : ""}${trade.pnlPercent.toFixed(2)}%`
    );
  }
}

export const telegramService = new TelegramService();
