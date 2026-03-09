export type PriceAlertDirection = "above" | "below";
export type PriceAlertStatus = "active" | "triggered" | "paused";
export type WalletAlertKind = "receive_transfer" | "send_transfer" | "new_token" | "receive_nft";
export type WalletAlertStatus = "active" | "triggered" | "paused";

export interface PriceAlert {
  id: string;
  ownerWallet: string;
  name: string;
  pair: string;
  inputMint: string;
  outputMint: string;
  direction: PriceAlertDirection;
  targetPrice: number;
  status: PriceAlertStatus;
  currentPrice?: number;
  lastCheckedAt?: string;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertEvent {
  id: string;
  ownerWallet: string;
  alertId: string;
  alertName: string;
  pair: string;
  direction: PriceAlertDirection;
  targetPrice: number;
  currentPrice: number;
  triggeredAt: string;
}

export interface WalletAlert {
  id: string;
  ownerWallet: string;
  name: string;
  walletAddress: string;
  watchKind: WalletAlertKind;
  status: WalletAlertStatus;
  lastSeenBalanceLamports?: number;
  lastSeenTokenMints?: string[];
  lastSeenNftMints?: string[];
  lastCheckedAt?: string;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletAlertEvent {
  id: string;
  ownerWallet: string;
  alertId: string;
  alertName: string;
  walletAddress: string;
  watchKind: WalletAlertKind;
  previousBalanceLamports: number;
  currentBalanceLamports: number;
  deltaLamports: number;
  assetMint?: string;
  triggeredAt: string;
}
