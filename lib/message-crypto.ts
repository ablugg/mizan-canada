import crypto from "crypto";

// AES-256-GCM encryption for message content at rest.
// Key is derived from BRIDGE_SECRET so DB access alone is insufficient to read content.
// This is server-side symmetric encryption; assistant messages additionally use
// client-side ECDH encryption layered on top.

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.BRIDGE_SECRET || "dev-fallback-insecure";
  // SHA-256 is fast (no event-loop block) and sufficient — BRIDGE_SECRET is already high-entropy.
  cachedKey = crypto.createHash("sha256").update(secret).update("mizan-msg-v1").digest();
  return cachedKey;
}

export function encryptMessage(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) + tag(16) + ciphertext — stored as base64url
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptMessage(encoded: string): string {
  const buf = Buffer.from(encoded, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
