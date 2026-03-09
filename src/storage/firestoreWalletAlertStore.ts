import type { Firestore } from "firebase-admin/firestore";
import type { WalletAlert } from "../types/radar.js";
import type { WalletAlertStoreContract } from "./contracts.js";

export class FirestoreWalletAlertStore implements WalletAlertStoreContract {
  constructor(private readonly db: Firestore) {}

  async init(): Promise<void> {}

  async list(): Promise<WalletAlert[]> {
    return this.fetchAll();
  }

  async listByOwner(ownerWallet: string): Promise<WalletAlert[]> {
    const items = await this.fetchAll();
    return items.filter((item) => item.ownerWallet === ownerWallet);
  }

  async getById(id: string): Promise<WalletAlert | undefined> {
    const snap = await this.db.collection("wallet_alerts").doc(id).get();
    if (!snap.exists) {
      return undefined;
    }
    return snap.data() as WalletAlert;
  }

  async getByIdForOwner(id: string, ownerWallet: string): Promise<WalletAlert | undefined> {
    const item = await this.getById(id);
    return item?.ownerWallet === ownerWallet ? item : undefined;
  }

  async upsert(alert: WalletAlert): Promise<void> {
    await this.db.collection("wallet_alerts").doc(alert.id).set(alert);
  }

  async remove(id: string): Promise<boolean> {
    const ref = this.db.collection("wallet_alerts").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return false;
    }
    await ref.delete();
    return true;
  }

  async removeForOwner(id: string, ownerWallet: string): Promise<boolean> {
    const ref = this.db.collection("wallet_alerts").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return false;
    }

    const data = snap.data() as WalletAlert;
    if (data.ownerWallet !== ownerWallet) {
      return false;
    }

    await ref.delete();
    return true;
  }

  private async fetchAll(): Promise<WalletAlert[]> {
    const snap = await this.db.collection("wallet_alerts").get();
    return snap.docs.map((doc) => doc.data() as WalletAlert).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
