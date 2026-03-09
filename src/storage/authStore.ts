import { randomBytes } from "node:crypto";
import type { AuthStoreContract, SessionRecord } from "./contracts.js";

interface NonceRecord {
  wallet: string;
  nonce: string;
  expiresAt: number;
}

export class AuthStore implements AuthStoreContract {
  private nonces = new Map<string, NonceRecord>();
  private sessions = new Map<string, SessionRecord>();

  async issueNonce(wallet: string, ttlMs = 5 * 60 * 1000): Promise<string> {
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(wallet, {
      wallet,
      nonce,
      expiresAt: Date.now() + ttlMs
    });
    return nonce;
  }

  async consumeNonce(wallet: string, nonce: string): Promise<boolean> {
    const rec = this.nonces.get(wallet);
    if (!rec) return false;
    if (rec.nonce !== nonce) return false;
    if (rec.expiresAt < Date.now()) {
      this.nonces.delete(wallet);
      return false;
    }
    this.nonces.delete(wallet);
    return true;
  }

  async issueSession(wallet: string, ttlMs = 24 * 60 * 60 * 1000): Promise<string> {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, {
      wallet,
      token,
      expiresAt: Date.now() + ttlMs
    });
    return token;
  }

  async verifySession(token: string): Promise<SessionRecord | null> {
    const rec = this.sessions.get(token);
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return rec;
  }

  async revokeSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
