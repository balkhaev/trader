import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex-encoded
    OPENAI_API_KEY: z.string().min(1).optional(),
    TWITTER_BEARER_TOKEN: z.string().optional(),
    // Telegram MTProto
    TELEGRAM_API_ID: z.coerce.number().optional(),
    TELEGRAM_API_HASH: z.string().optional(),
    TELEGRAM_SESSION_STRING: z.string().optional(),
    TELEGRAM_PHONE: z.string().optional(),
    // Playwright
    PLAYWRIGHT_HEADLESS: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    PLAYWRIGHT_MAX_BROWSERS: z.coerce.number().default(3),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
