import { env } from "@trader/env/server";
import * as readline from "readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  if (!(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH)) {
    console.error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
    process.exit(1);
  }

  console.log("Telegram Authorization Script");
  console.log("=============================\n");

  const session = new StringSession("");
  const client = new TelegramClient(
    session,
    env.TELEGRAM_API_ID,
    env.TELEGRAM_API_HASH,
    {
      connectionRetries: 5,
    }
  );

  await client.start({
    phoneNumber: async () => await prompt("Phone number (with country code): "),
    password: async () => await prompt("2FA Password (if enabled): "),
    phoneCode: async () => await prompt("Code from Telegram: "),
    onError: (err) => console.error("Error:", err),
  });

  const sessionString = client.session.save() as unknown as string;

  console.log("\n=============================");
  console.log("Authorization successful!\n");
  console.log("Add this to your .env file:");
  console.log(`TELEGRAM_SESSION_STRING=${sessionString}`);
  console.log("=============================\n");

  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
