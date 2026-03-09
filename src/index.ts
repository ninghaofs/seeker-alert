import "dotenv/config";
import cors from "cors";
import express from "express";
import type { RequestHandler } from "express";
import { buildAuthRouter } from "./api/authRouter.js";
import { buildAuthMiddleware } from "./api/authMiddleware.js";
import { buildRadarRouter } from "./api/radarRouter.js";
import { PriceAlertEngine } from "./engine/priceAlertEngine.js";
import { WalletAlertEngine } from "./engine/walletAlertEngine.js";
import { PriceFeed } from "./solana/priceFeed.js";
import { TokenRegistry } from "./solana/tokenRegistry.js";
import { AuthStore } from "./storage/authStore.js";
import { PriceAlertEventStore } from "./storage/priceAlertEventStore.js";
import { PriceAlertStore } from "./storage/priceAlertStore.js";
import { WalletAlertEventStore } from "./storage/walletAlertEventStore.js";
import { WalletAlertStore } from "./storage/walletAlertStore.js";

const port = Number(process.env.PORT ?? 3000);
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const priceAlertIntervalMs = Number(process.env.PRICE_ALERT_INTERVAL_MS ?? 30000);
const walletAlertIntervalMs = Number(process.env.WALLET_ALERT_INTERVAL_MS ?? 30000);
const authRequired = String(process.env.AUTH_REQUIRED ?? "true") === "true";

const app = express();
app.use(cors());
app.use(express.json());

const priceAlertStore = new PriceAlertStore();
await priceAlertStore.init();
const priceAlertEventStore = new PriceAlertEventStore();
await priceAlertEventStore.init();
const walletAlertStore = new WalletAlertStore();
await walletAlertStore.init();
const walletAlertEventStore = new WalletAlertEventStore();
await walletAlertEventStore.init();
const authStore = new AuthStore();

const priceFeed = new PriceFeed();
const tokenRegistry = new TokenRegistry();
const priceAlertEngine = new PriceAlertEngine(priceAlertStore, priceAlertEventStore, priceFeed, priceAlertIntervalMs);
const walletAlertEngine = new WalletAlertEngine(rpcUrl, walletAlertStore, walletAlertEventStore, walletAlertIntervalMs);
const authMiddleware = buildAuthMiddleware(authStore);
const noAuthMiddleware: RequestHandler = (_req, _res, next) => next();
const maybeAuthMiddleware = authRequired ? authMiddleware : noAuthMiddleware;

app.get("/health", (_req, res) => {
  res.json({ ok: true, authRequired, priceAlertIntervalMs, walletAlertIntervalMs, rpcUrl });
});

app.get("/api/token-meta", async (req, res) => {
  const mint = typeof req.query.mint === "string" ? req.query.mint : "";
  if (!mint) {
    res.status(400).json({ error: "missing mint" });
    return;
  }

  try {
    res.json(await tokenRegistry.getTokenMetadata(mint));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.use("/api/auth", buildAuthRouter(authStore));
app.use(
  "/api/radar",
  maybeAuthMiddleware,
  buildRadarRouter(
    priceAlertStore,
    priceAlertEventStore,
    priceAlertEngine,
    walletAlertStore,
    walletAlertEventStore,
    walletAlertEngine
  )
);

app.listen(port, () => {
  priceAlertEngine.start();
  walletAlertEngine.start();
  console.log(
    `seeker alert server on :${port} (authRequired=${authRequired}, priceAlertIntervalMs=${priceAlertIntervalMs}, walletAlertIntervalMs=${walletAlertIntervalMs})`
  );
});
