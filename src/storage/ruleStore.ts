import { promises as fs } from "node:fs";
import path from "node:path";
import type { TradingRule } from "../types/trading.js";

const DATA_DIR = path.resolve("data");
const RULES_FILE = path.join(DATA_DIR, "trading-rules.json");

export class RuleStore {
  private rules: TradingRule[] = [];

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(RULES_FILE, "utf-8");
      this.rules = JSON.parse(raw) as TradingRule[];
    } catch {
      this.rules = [];
      await this.persist();
    }
  }

  list(): TradingRule[] {
    return this.rules;
  }

  findById(id: string): TradingRule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  async upsert(rule: TradingRule): Promise<void> {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    await this.persist();
  }

  async delete(id: string): Promise<boolean> {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    if (this.rules.length === before) {
      return false;
    }
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await fs.writeFile(RULES_FILE, JSON.stringify(this.rules, null, 2), "utf-8");
  }
}
