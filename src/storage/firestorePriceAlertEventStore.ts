import type { Firestore } from "firebase-admin/firestore";
import type { PriceAlertEvent } from "../types/radar.js";
import type { PriceAlertEventStoreContract } from "./contracts.js";

export class FirestorePriceAlertEventStore implements PriceAlertEventStoreContract {
  constructor(private readonly db: Firestore) {}

  async init(): Promise<void> {}

  async list(limit = 50): Promise<PriceAlertEvent[]> {
    const items = await this.fetchAll();
    return items.slice(0, limit);
  }

  async listByOwner(ownerWallet: string, limit = 50): Promise<PriceAlertEvent[]> {
    const items = await this.fetchAll();
    return items.filter((item) => item.ownerWallet === ownerWallet).slice(0, limit);
  }

  async append(event: PriceAlertEvent): Promise<void> {
    await this.db.collection("price_alert_events").doc(event.id).set(event);
  }

  private async fetchAll(): Promise<PriceAlertEvent[]> {
    const snap = await this.db.collection("price_alert_events").get();
    return snap.docs.map((doc) => doc.data() as PriceAlertEvent).sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }
}
