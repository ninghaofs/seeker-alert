import type { DcaRule, ExecutionOrder, MarketPrice } from "../types/trading.js";

export function evaluateDca(rule: DcaRule, _price: MarketPrice): ExecutionOrder | null {
  const now = Date.now();
  const state = rule.state ?? { runs: 0 };

  if (rule.config.maxRuns && state.runs >= rule.config.maxRuns) {
    return null;
  }

  if (state.lastRunAt) {
    const elapsedMs = now - new Date(state.lastRunAt).getTime();
    const intervalMs = rule.config.intervalMinutes * 60 * 1000;
    if (elapsedMs < intervalMs) {
      return null;
    }
  }

  return {
    ruleId: rule.id,
    side: rule.config.side,
    inputMint: rule.inputMint,
    outputMint: rule.outputMint,
    amount: rule.config.amountPerInterval,
    reason: `DCA interval hit (${rule.config.intervalMinutes}m)`
  };
}
