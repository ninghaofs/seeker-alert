import { evaluateDca } from "../strategies/dca.js";
import { evaluateGrid } from "../strategies/grid.js";
import { evaluateLimitOrder } from "../strategies/limitOrder.js";
import { RuleStore } from "../storage/ruleStore.js";
import type { TradingRule } from "../types/trading.js";
import { PriceFeed } from "../solana/priceFeed.js";
import { SolanaExecutor } from "../solana/executor.js";

export class TradingEngine {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly ruleStore: RuleStore,
    private readonly priceFeed: PriceFeed,
    private readonly executor: SolanaExecutor,
    private readonly tickIntervalMs: number
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    const rules = this.ruleStore.list().filter((r) => r.enabled);

    for (const rule of rules) {
      try {
        const price = await this.priceFeed.getPrice(rule.inputMint, rule.outputMint);
        const order = this.evaluateRule(rule, price.price);
        if (!order) {
          continue;
        }

        const result = await this.executor.execute(order);
        await this.markState(rule, result.txid);

        console.log(
          `[EXECUTED] rule=${rule.id} strategy=${rule.strategyType} simulated=${result.simulated} txid=${result.txid ?? "N/A"}`
        );
      } catch (err) {
        console.error(`[ERROR] rule=${rule.id}`, err);
      }
    }
  }

  private evaluateRule(rule: TradingRule, currentPrice: number) {
    const market = {
      inputMint: rule.inputMint,
      outputMint: rule.outputMint,
      price: currentPrice,
      timestamp: Date.now()
    };

    switch (rule.strategyType) {
      case "dca":
        return evaluateDca(rule, market);
      case "grid":
        return evaluateGrid(rule, market);
      case "limit_order":
        return evaluateLimitOrder(rule, market);
      default:
        return null;
    }
  }

  private async markState(rule: TradingRule, _txid?: string): Promise<void> {
    const now = new Date().toISOString();

    if (rule.strategyType === "dca") {
      const state = rule.state ?? { runs: 0 };
      rule.state = {
        runs: state.runs + 1,
        lastRunAt: now
      };
    }

    if (rule.strategyType === "grid") {
      // MVP: mark nearest level as triggered
      const state = rule.state ?? { triggeredLevels: {} };
      const triggeredCount = Object.keys(state.triggeredLevels).length;
      state.triggeredLevels[String(triggeredCount)] = true;
      rule.state = state;
    }

    if (rule.strategyType === "limit_order") {
      rule.state = { triggered: true };
    }

    rule.updatedAt = now;
    await this.ruleStore.upsert(rule);
  }
}
