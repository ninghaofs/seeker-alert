export type StrategyType = "dca" | "grid" | "limit_order";

export type Side = "buy" | "sell";

export interface BaseRule {
  id: string;
  name: string;
  enabled: boolean;
  strategyType: StrategyType;
  inputMint: string;
  outputMint: string;
  createdAt: string;
  updatedAt: string;
}

export interface DcaConfig {
  side: Side;
  amountPerInterval: number;
  intervalMinutes: number;
  maxRuns?: number;
}

export interface GridLevel {
  price: number;
  amount: number;
  side: Side;
}

export interface GridConfig {
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  amountPerGrid: number;
}

export interface LimitOrderConfig {
  side: Side;
  triggerPrice: number;
  amount: number;
  expiresAt?: string;
}

export interface DcaRule extends BaseRule {
  strategyType: "dca";
  config: DcaConfig;
  state?: {
    runs: number;
    lastRunAt?: string;
  };
}

export interface GridRule extends BaseRule {
  strategyType: "grid";
  config: GridConfig;
  state?: {
    triggeredLevels: Record<string, boolean>;
  };
}

export interface LimitOrderRule extends BaseRule {
  strategyType: "limit_order";
  config: LimitOrderConfig;
  state?: {
    triggered: boolean;
  };
}

export type TradingRule = DcaRule | GridRule | LimitOrderRule;

export interface MarketPrice {
  inputMint: string;
  outputMint: string;
  price: number;
  timestamp: number;
}

export interface ExecutionOrder {
  ruleId: string;
  side: Side;
  inputMint: string;
  outputMint: string;
  amount: number;
  reason: string;
}
