import { PublicKey } from "@solana/web3.js";

export type TokenMetadata = {
  mint: string;
  name: string;
  symbol: string;
  decimals?: number;
  icon?: string;
};

type JupiterTokenSearchResult = {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
};

export class TokenRegistry {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.JUPITER_TOKEN_API_BASE ?? "https://lite-api.jup.ag/tokens/v2") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getTokenMetadata(mint: string): Promise<TokenMetadata> {
    try {
      new PublicKey(mint);
    } catch {
      throw new Error("invalid token mint");
    }

    const response = await fetch(`${this.baseUrl}/search?query=${encodeURIComponent(mint)}`, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`jupiter token api failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as JupiterTokenSearchResult[];
    const matched = data.find((item) => item.id === mint);

    if (!matched?.name || !matched.symbol) {
      throw new Error("token metadata not found");
    }

    return {
      mint,
      name: matched.name,
      symbol: matched.symbol,
      decimals: matched.decimals,
      icon: matched.icon
    };
  }
}
