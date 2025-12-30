import { env } from "@trader/env/server";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = getKey();

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const ivBuffer = Buffer.from(iv);
  const encrypted = encryptSync(key, ivBuffer, data);

  // Format: iv:authTag:ciphertext (all base64)
  return `${ivBuffer.toString("base64")}:${encrypted.authTag.toString("base64")}:${encrypted.ciphertext.toString("base64")}`;
}

export function decrypt(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const ivB64 = parts[0] as string;
  const authTagB64 = parts[1] as string;
  const ciphertextB64 = parts[2] as string;

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const key = getKey();

  const decrypted = decryptSync(key, iv, ciphertext, authTag);

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Sync wrappers using Node.js crypto (available in Bun)
function encryptSync(
  key: Buffer,
  iv: Buffer,
  data: Uint8Array
): { ciphertext: Buffer; authTag: Buffer } {
  const nodeCrypto = require("node:crypto");
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext: encrypted, authTag };
}

function decryptSync(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  authTag: Buffer
): Buffer {
  const nodeCrypto = require("node:crypto");
  const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Генерация нового ключа шифрования (для .env)
export function generateEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}
