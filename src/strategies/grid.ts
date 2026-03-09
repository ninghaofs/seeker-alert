import type { ExecutionOrder, GridRule, MarketPrice } from "../types/trading.js";

export function evaluateGrid(rule: GridRule, price: MarketPrice): ExecutionOrder | null {
  const { lowerPrice, upperPrice, gridCount, amountPerGrid } = rule.config;
  if (price.price < lowerPrice || price.price > upperPrice) {
    return null;
  }

  const step = (upperPrice - lowerPrice) / (gridCount - 1);
  const levelIndex = Math.round((price.price - lowerPrice) / step);
  const levelPrice = Number((lowerPrice + levelIndex * step).toFixed(6));

  const state = rule.state ?? { triggeredLevels: {} };
  const key = String(levelIndex);
  if (state.triggeredLevels[key]) {
    return null;
  }

  const mid = Math.floor(gridCount / 2);
  const side = levelIndex <= mid ? "buy" : "sell";

  return {
    ruleId: rule.id,
    side,
    inputMint: rule.inputMint,
    outputMint: rule.outputMint,
    amount: amountPerGrid,
    reason: `Grid level ${levelIndex} triggered @ ${levelPrice}`
  };
}
