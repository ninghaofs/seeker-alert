import type { PriceAlert, PriceAlertEvent, WalletAlert, WalletAlertEvent } from "../types/radar.js";

export interface SessionRecord {
  wallet: string;
  token: string;
  expiresAt: number;
}

export interface AuthStoreContract {
  issueNonce(wallet: string, ttlMs?: number): Promise<string>;
  consumeNonce(wallet: string, nonce: string): Promise<boolean>;
  issueSession(wallet: string, ttlMs?: number): Promise<string>;
  verifySession(token: string): Promise<SessionRecord | null>;
  revokeSession(token: string): Promise<void>;
}

export interface PriceAlertStoreContract {
  init(): Promise<void>;
  list(): Promise<PriceAlert[]>;
  listByOwner(ownerWallet: string): Promise<PriceAlert[]>;
  getById(id: string): Promise<PriceAlert | undefined>;
  getByIdForOwner(id: string, ownerWallet: string): Promise<PriceAlert | undefined>;
  upsert(alert: PriceAlert): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface WalletAlertStoreContract {
  init(): Promise<void>;
  list(): Promise<WalletAlert[]>;
  listByOwner(ownerWallet: string): Promise<WalletAlert[]>;
  getById(id: string): Promise<WalletAlert | undefined>;
  getByIdForOwner(id: string, ownerWallet: string): Promise<WalletAlert | undefined>;
  upsert(alert: WalletAlert): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface PriceAlertEventStoreContract {
  init(): Promise<void>;
  list(limit?: number): Promise<PriceAlertEvent[]>;
  listByOwner(ownerWallet: string, limit?: number): Promise<PriceAlertEvent[]>;
  append(event: PriceAlertEvent): Promise<void>;
}

export interface WalletAlertEventStoreContract {
  init(): Promise<void>;
  list(limit?: number): Promise<WalletAlertEvent[]>;
  listByOwner(ownerWallet: string, limit?: number): Promise<WalletAlertEvent[]>;
  append(event: WalletAlertEvent): Promise<void>;
}
