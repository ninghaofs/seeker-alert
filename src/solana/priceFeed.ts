import type { MarketPrice } from "../types/trading.js";

export class PriceFeed {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.JUPITER_PRICE_API_BASE ?? "https://lite-api.jup.ag") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getPrice(inputMint: string, outputMint: string): Promise<MarketPrice> {
    if (inputMint === outputMint) {
      return {
        inputMint,
        outputMint,
        price: 1,
        timestamp: Date.now()
      };
    }

    const ids = [inputMint, outputMint].join(",");
    const response = await fetch(`${this.baseUrl}/price/v3?ids=${encodeURIComponent(ids)}`, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`jupiter price api failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<
      string,
      {
        usdPrice?: number;
        price?: string | number;
        createdAt?: string;
      }
    >;

    const inputUsd = this.readUsdPrice(data[inputMint]);
    const outputUsd = this.readUsdPrice(data[outputMint]);

    if (inputUsd == null || outputUsd == null) {
      throw new Error("jupiter price api missing token price");
    }

    const derivedPrice = Number((inputUsd / outputUsd).toFixed(8));
    return {
      inputMint,
      outputMint,
      price: derivedPrice,
      timestamp: Date.now()
    };
  }

  private readUsdPrice(
    payload?: {
      usdPrice?: number;
      price?: string | number;
    }
  ): number | null {
    if (!payload) {
      return null;
    }

    if (typeof payload.usdPrice === "number" && Number.isFinite(payload.usdPrice) && payload.usdPrice > 0) {
      return payload.usdPrice;
    }

    if (typeof payload.price === "number" && Number.isFinite(payload.price) && payload.price > 0) {
      return payload.price;
    }

    if (typeof payload.price === "string") {
      const parsed = Number(payload.price);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }
}
