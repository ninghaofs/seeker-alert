import type { ExecutionOrder, LimitOrderRule, MarketPrice } from "../types/trading.js";

export function evaluateLimitOrder(rule: LimitOrderRule, price: MarketPrice): ExecutionOrder | null {
  if (rule.state?.triggered) {
    return null;
  }

  if (rule.config.expiresAt && new Date(rule.config.expiresAt).getTime() < Date.now()) {
    return null;
  }

  const shouldTrigger =
    rule.config.side === "buy"
      ? price.price <= rule.config.triggerPrice
      : price.price >= rule.config.triggerPrice;

  if (!shouldTrigger) {
    return null;
  }

  return {
    ruleId: rule.id,
    side: rule.config.side,
    inputMint: rule.inputMint,
    outputMint: rule.outputMint,
    amount: rule.config.amount,
    reason: `Limit order triggered @ ${price.price}`
  };
}
