import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletAlertEventStoreContract, WalletAlertStoreContract } from "../storage/contracts.js";
import type { WalletAlert } from "../types/radar.js";
import { newId } from "../utils/id.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkS6R8mW7x7n5oVSVuN9B2bWj");

type WalletSnapshot = {
  balanceLamports: number;
  tokenMints: string[];
  nftMints: string[];
};

export class WalletAlertEngine {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly connection: Connection;

  constructor(
    rpcUrl: string,
    private readonly walletAlertStore: WalletAlertStoreContract,
    private readonly walletAlertEventStore: WalletAlertEventStoreContract,
    private readonly intervalMs: number
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.checkAll();
    }, this.intervalMs);

    void this.checkAll();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  async checkAll(): Promise<WalletAlert[]> {
    if (this.running) {
      return this.walletAlertStore.list();
    }

    this.running = true;
    try {
      const alerts = await this.walletAlertStore.list();
      const checked: WalletAlert[] = [];
      const snapshots = new Map<string, WalletSnapshot>();

      for (const alert of alerts) {
        if (alert.status === "paused") {
          checked.push(alert);
          continue;
        }

        try {
          const snapshot = await this.getWalletSnapshot(alert.walletAddress, snapshots);
          const now = new Date().toISOString();
          const previousBalanceLamports = alert.lastSeenBalanceLamports;
          const previousTokenMints = alert.lastSeenTokenMints ?? [];
          const previousNftMints = alert.lastSeenNftMints ?? [];

          if (
            previousBalanceLamports == null &&
            alert.lastSeenTokenMints == null &&
            alert.lastSeenNftMints == null
          ) {
            const initializedAlert: WalletAlert = {
              ...alert,
              lastSeenBalanceLamports: snapshot.balanceLamports,
              lastSeenTokenMints: snapshot.tokenMints,
              lastSeenNftMints: snapshot.nftMints,
              lastCheckedAt: now,
              updatedAt: now
            };
            await this.walletAlertStore.upsert(initializedAlert);
            checked.push(initializedAlert);
            continue;
          }

          const deltaLamports = snapshot.balanceLamports - (previousBalanceLamports ?? snapshot.balanceLamports);
          const newTokenMints = snapshot.tokenMints.filter((mint) => !previousTokenMints.includes(mint));
          const newNftMints = snapshot.nftMints.filter((mint) => !previousNftMints.includes(mint));

          const triggered =
            alert.watchKind === "receive_transfer"
              ? deltaLamports > 0
              : alert.watchKind === "send_transfer"
                ? deltaLamports < 0
                : alert.watchKind === "new_token"
                  ? newTokenMints.length > 0
                  : newNftMints.length > 0;
          const justTriggered = alert.status !== "triggered" && triggered;

          const nextAlert: WalletAlert = {
            ...alert,
            lastSeenBalanceLamports: snapshot.balanceLamports,
            lastSeenTokenMints: snapshot.tokenMints,
            lastSeenNftMints: snapshot.nftMints,
            lastCheckedAt: now,
            lastTriggeredAt: triggered ? now : alert.lastTriggeredAt,
            status: triggered ? "triggered" : "active",
            updatedAt: now
          };

          await this.walletAlertStore.upsert(nextAlert);
          if (justTriggered) {
            await this.walletAlertEventStore.append({
              id: newId(),
              ownerWallet: alert.ownerWallet,
              alertId: alert.id,
              alertName: alert.name,
              walletAddress: alert.walletAddress,
              watchKind: alert.watchKind,
              previousBalanceLamports: previousBalanceLamports ?? snapshot.balanceLamports,
              currentBalanceLamports: snapshot.balanceLamports,
              deltaLamports,
              assetMint:
                alert.watchKind === "new_token" ? newTokenMints[0] : alert.watchKind === "receive_nft" ? newNftMints[0] : undefined,
              triggeredAt: now
            });
          }
          checked.push(nextAlert);
        } catch (error) {
          console.error("[wallet-alert] check failed", { alertId: alert.id, walletAddress: alert.walletAddress, error });
          checked.push(alert);
        }
      }

      return checked;
    } finally {
      this.running = false;
    }
  }

  private async getWalletSnapshot(walletAddress: string, cache: Map<string, WalletSnapshot>): Promise<WalletSnapshot> {
    const cached = cache.get(walletAddress);
    if (cached) {
      return cached;
    }

    const owner = new PublicKey(walletAddress);
    const [balanceLamports, tokenAccounts, token2022Accounts] = await Promise.all([
      this.connection.getBalance(owner, "confirmed"),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")
    ]);

    const positiveAccounts = [...tokenAccounts.value, ...token2022Accounts.value].filter((account) => {
      const parsed = account.account.data.parsed.info.tokenAmount;
      return Number(parsed.amount) > 0;
    });

    const nftMints = [
      ...new Set(
        positiveAccounts
          .filter((account) => {
            const tokenAmount = account.account.data.parsed.info.tokenAmount;
            return Number(tokenAmount.amount) === 1 && Number(tokenAmount.decimals) === 0;
          })
          .map((account) => account.account.data.parsed.info.mint as string)
      )
    ];
    const nftMintSet = new Set(nftMints);
    const tokenMints = [
      ...new Set(
        positiveAccounts
          .map((account) => account.account.data.parsed.info.mint as string)
          .filter((mint) => !nftMintSet.has(mint))
      )
    ];

    const snapshot: WalletSnapshot = { balanceLamports, tokenMints, nftMints };
    cache.set(walletAddress, snapshot);
    return snapshot;
  }
}
