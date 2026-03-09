import { PriceFeed } from "../solana/priceFeed.js";
import type { PriceAlertEventStoreContract, PriceAlertStoreContract } from "../storage/contracts.js";
import type { PriceAlert } from "../types/radar.js";
import { newId } from "../utils/id.js";

export class PriceAlertEngine {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly priceAlertStore: PriceAlertStoreContract,
    private readonly priceAlertEventStore: PriceAlertEventStoreContract,
    private readonly priceFeed: PriceFeed,
    private readonly intervalMs: number
  ) {}

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

  async checkAll(): Promise<PriceAlert[]> {
    if (this.running) {
      return this.priceAlertStore.list();
    }

    this.running = true;
    try {
      const alerts = await this.priceAlertStore.list();
      const checked: PriceAlert[] = [];

      for (const alert of alerts) {
        if (alert.status === "paused") {
          checked.push(alert);
          continue;
        }

        try {
          const market = await this.priceFeed.getPrice(alert.inputMint, alert.outputMint);
          const now = new Date().toISOString();
          const triggered =
            alert.direction === "above" ? market.price >= alert.targetPrice : market.price <= alert.targetPrice;
          const justTriggered = alert.status !== "triggered" && triggered;

          const nextAlert: PriceAlert = {
            ...alert,
            currentPrice: market.price,
            lastCheckedAt: now,
            lastTriggeredAt: triggered ? now : alert.lastTriggeredAt,
            status: triggered ? "triggered" : "active",
            updatedAt: now
          };

          await this.priceAlertStore.upsert(nextAlert);
          if (justTriggered) {
            await this.priceAlertEventStore.append({
              id: newId(),
              ownerWallet: alert.ownerWallet,
              alertId: alert.id,
              alertName: alert.name,
              pair: alert.pair,
              direction: alert.direction,
              targetPrice: alert.targetPrice,
              currentPrice: market.price,
              triggeredAt: now
            });
          }
          checked.push(nextAlert);
        } catch (error) {
          console.error("[price-alert] check failed", { alertId: alert.id, error });
          checked.push(alert);
        }
      }

      return checked;
    } finally {
      this.running = false;
    }
  }
}
