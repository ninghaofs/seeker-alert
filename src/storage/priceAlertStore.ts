import { promises as fs } from "node:fs";
import path from "node:path";
import type { PriceAlert } from "../types/radar.js";
import type { PriceAlertStoreContract } from "./contracts.js";

const DATA_DIR = path.resolve("data");
const ALERTS_FILE = path.join(DATA_DIR, "price-alerts.json");

export class PriceAlertStore implements PriceAlertStoreContract {
  private alerts: PriceAlert[] = [];

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(ALERTS_FILE, "utf-8");
      this.alerts = JSON.parse(raw) as PriceAlert[];
    } catch {
      this.alerts = [];
      await this.persist();
    }
  }

  async list(): Promise<PriceAlert[]> {
    return this.alerts;
  }

  async listByOwner(ownerWallet: string): Promise<PriceAlert[]> {
    return this.alerts.filter((item) => item.ownerWallet === ownerWallet);
  }

  async getById(id: string): Promise<PriceAlert | undefined> {
    return this.alerts.find((item) => item.id === id);
  }

  async getByIdForOwner(id: string, ownerWallet: string): Promise<PriceAlert | undefined> {
    return this.alerts.find((item) => item.id === id && item.ownerWallet === ownerWallet);
  }

  async upsert(alert: PriceAlert): Promise<void> {
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
