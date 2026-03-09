import { promises as fs } from "node:fs";
import path from "node:path";
import type { WalletAlertEvent } from "../types/radar.js";
import type { WalletAlertEventStoreContract } from "./contracts.js";

const DATA_DIR = path.resolve("data");
const EVENTS_FILE = path.join(DATA_DIR, "wallet-alert-events.json");

export class WalletAlertEventStore implements WalletAlertEventStoreContract {
  private events: WalletAlertEvent[] = [];

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(EVENTS_FILE, "utf-8");
      this.events = JSON.parse(raw) as WalletAlertEvent[];
    } catch {
      this.events = [];
      await this.persist();
    }
  }

  async list(limit = 50): Promise<WalletAlertEvent[]> {
    return this.events.slice(0, limit);
  }

  async listByOwner(ownerWallet: string, limit = 50): Promise<WalletAlertEvent[]> {
    return this.events.filter((item) => item.ownerWallet === ownerWallet).slice(0, limit);
  }

  async append(event: WalletAlertEvent): Promise<void> {
    this.events.unshift(event);
    this.events = this.events.slice(0, 200);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.writeFile(EVENTS_FILE, JSON.stringify(this.events, null, 2), "utf-8");
  }
}
