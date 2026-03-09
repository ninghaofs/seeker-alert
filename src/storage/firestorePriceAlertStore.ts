import type { Firestore } from "firebase-admin/firestore";
import type { PriceAlert } from "../types/radar.js";
import type { PriceAlertStoreContract } from "./contracts.js";

export class FirestorePriceAlertStore implements PriceAlertStoreContract {
  constructor(private readonly db: Firestore) {}

  async init(): Promise<void> {}

  async list(): Promise<PriceAlert[]> {
    return this.fetchAll();
  }

  async listByOwner(ownerWallet: string): Promise<PriceAlert[]> {
    const items = await this.fetchAll();
    return items.filter((item) => item.ownerWallet === ownerWallet);
  }

  async getById(id: string): Promise<PriceAlert | undefined> {
    const snap = await this.db.collection("price_alerts").doc(id).get();
    if (!snap.exists) {
      return undefined;
    }
    return snap.data() as PriceAlert;
  }

  async getByIdForOwner(id: string, ownerWallet: string): Promise<PriceAlert | undefined> {
    const item = await this.getById(id);
    return item?.ownerWallet === ownerWallet ? item : undefined;
  }

  async upsert(alert: PriceAlert): Promise<void> {
    await this.db.collection("price_alerts").doc(alert.id).set(alert);
  }

  async remove(id: string): Promise<boolean> {
    const ref = this.db.collection("price_alerts").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return false;
    }
    await ref.delete();
    return true;
  }

  private async fetchAll(): Promise<PriceAlert[]> {
    const snap = await this.db.collection("price_alerts").get();
    return snap.docs.map((doc) => doc.data() as PriceAlert).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
