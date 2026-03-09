import { promises as fs } from "node:fs";
import path from "node:path";
import type { WalletAlert } from "../types/radar.js";
import type { WalletAlertStoreContract } from "./contracts.js";

const DATA_DIR = path.resolve("data");
const ALERTS_FILE = path.join(DATA_DIR, "wallet-alerts.json");

export class WalletAlertStore implements WalletAlertStoreContract {
  private alerts: WalletAlert[] = [];

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(ALERTS_FILE, "utf-8");
      this.alerts = JSON.parse(raw) as WalletAlert[];
    } catch {
      this.alerts = [];
      await this.persist();
    }
  }

  async list(): Promise<WalletAlert[]> {
    return this.alerts;
  }

  async listByOwner(ownerWallet: string): Promise<WalletAlert[]> {
    return this.alerts.filter((item) => item.ownerWallet === ownerWallet);
  }

  async getById(id: string): Promise<WalletAlert | undefined> {
    return this.alerts.find((item) => item.id === id);
  }

  async getByIdForOwner(id: string, ownerWallet: string): Promise<WalletAlert | undefined> {
    return this.alerts.find((item) => item.id === id && item.ownerWallet === ownerWallet);
  }

  async upsert(alert: WalletAlert): Promise<void> {
    const index = this.alerts.findIndex((item) => item.id === alert.id);
    if (index >= 0) {
      this.alerts[index] = alert;
    } else {
      this.alerts.unshift(alert);
    }
    await this.persist();
  }

  async remove(id: string): Promise<boolean> {
    const nextAlerts = this.alerts.filter((item) => item.id !== id);
    if (nextAlerts.length === this.alerts.length) {
      return false;
    }

    this.alerts = nextAlerts;
    await this.persist();
    return true;
  }

  async removeForOwner(id: string, ownerWallet: string): Promise<boolean> {
    const nextAlerts = this.alerts.filter((item) => !(item.id === id && item.ownerWallet === ownerWallet));
    if (nextAlerts.length === this.alerts.length) {
      return false;
    }

    this.alerts = nextAlerts;
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await fs.writeFile(ALERTS_FILE, JSON.stringify(this.alerts, null, 2), "utf-8");
  }
}
