import type { Firestore } from "firebase-admin/firestore";
import type { WalletAlertEvent } from "../types/radar.js";
import type { WalletAlertEventStoreContract } from "./contracts.js";

export class FirestoreWalletAlertEventStore implements WalletAlertEventStoreContract {
  constructor(private readonly db: Firestore) {}

  async init(): Promise<void> {}

  async list(limit = 50): Promise<WalletAlertEvent[]> {
    const items = await this.fetchAll();
    return items.slice(0, limit);
  }

  async listByOwner(ownerWallet: string, limit = 50): Promise<WalletAlertEvent[]> {
    const items = await this.fetchAll();
    return items.filter((item) => item.ownerWallet === ownerWallet).slice(0, limit);
  }

  async append(event: WalletAlertEvent): Promise<void> {
    await this.db.collection("wallet_alert_events").doc(event.id).set(event);
  }

  private async fetchAll(): Promise<WalletAlertEvent[]> {
    const snap = await this.db.collection("wallet_alert_events").get();
    return snap.docs.map((doc) => doc.data() as WalletAlertEvent).sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }
}
