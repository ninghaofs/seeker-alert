import { Connection, Keypair } from "@solana/web3.js";
import type { ExecutionOrder } from "../types/trading.js";

export interface ExecutorConfig {
  rpcUrl: string;
  walletSecretKey?: string;
  dryRun: boolean;
}

export class SolanaExecutor {
  private connection: Connection;
  private keypair?: Keypair;
  private dryRun: boolean;

  constructor(config: ExecutorConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.dryRun = config.dryRun;

    if (config.walletSecretKey) {
      try {
        const secret = Uint8Array.from(JSON.parse(config.walletSecretKey) as number[]);
        this.keypair = Keypair.fromSecretKey(secret);
      } catch {
        throw new Error("WALLET_SECRET_KEY 格式错误，必须是 JSON 数组");
      }
    }
  }

  async execute(order: ExecutionOrder): Promise<{ txid?: string; simulated: boolean }> {
    if (this.dryRun) {
      return { simulated: true };
    }

    if (!this.keypair) {
      throw new Error("实盘模式需要 WALLET_SECRET_KEY");
    }

    await this.connection.getLatestBlockhash();

    // 这里只搭建执行框架。真实交易应在这里接 Jupiter/DEX 的 swap 或下单指令。
    console.log("[LIVE-PLACEHOLDER] execute order", order);

    return {
      txid: "live_placeholder_txid",
      simulated: false
    };
  }
}
