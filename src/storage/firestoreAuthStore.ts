import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AuthStoreContract, SessionRecord } from "./contracts.js";

interface NonceRecord {
  wallet: string;
  nonce: string;
  expiresAt: number;
}

export class FirestoreAuthStore implements AuthStoreContract {
  constructor(private readonly db: Firestore) {}

  async issueNonce(wallet: string, ttlMs = 5 * 60 * 1000): Promise<string> {
    const nonce = randomBytes(16).toString("hex");
    const rec: NonceRecord = {
      wallet,
      nonce,
      expiresAt: Date.now() + ttlMs
    };
    await this.db.collection("auth_nonces").doc(wallet).set(rec);
    return nonce;
  }

  async consumeNonce(wallet: string, nonce: string): Promise<boolean> {
    const ref = this.db.collection("auth_nonces").doc(wallet);
    const snap = await ref.get();
    if (!snap.exists) {
      return false;
    }

    const rec = snap.data() as NonceRecord;
    if (rec.nonce !== nonce || rec.expiresAt < Date.now()) {
      await ref.delete();
      return false;
    }

    await ref.delete();
    return true;
  }

  async issueSession(wallet: string, ttlMs = 24 * 60 * 60 * 1000): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const rec: SessionRecord = {
      wallet,
      token,
      expiresAt: Date.now() + ttlMs
    };
    await this.db.collection("auth_sessions").doc(token).set(rec);
    return token;
  }

  async verifySession(token: string): Promise<SessionRecord | null> {
    const ref = this.db.collection("auth_sessions").doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
      return null;
    }

    const rec = snap.data() as SessionRecord;
    if (rec.expiresAt < Date.now()) {
      await ref.delete();
      return null;
    }

    return rec;
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.collection("auth_sessions").doc(token).delete();
  }
}
