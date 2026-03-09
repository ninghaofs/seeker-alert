import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import type { RequestHandler } from "express";
import { buildRulesRouter } from "./api/rulesRouter.js";
import { TradingEngine } from "./engine/tradingEngine.js";
import { PriceAlertEngine } from "./engine/priceAlertEngine.js";
import { WalletAlertEngine } from "./engine/walletAlertEngine.js";
import { SolanaExecutor } from "./solana/executor.js";
import { PriceFeed } from "./solana/priceFeed.js";
import { RuleStore } from "./storage/ruleStore.js";
import { AuthStore } from "./storage/authStore.js";
import { buildAuthRouter } from "./api/authRouter.js";
import { buildAuthMiddleware } from "./api/authMiddleware.js";
import { PriceAlertEventStore } from "./storage/priceAlertEventStore.js";
import { PriceAlertStore } from "./storage/priceAlertStore.js";
import { WalletAlertEventStore } from "./storage/walletAlertEventStore.js";
import { WalletAlertStore } from "./storage/walletAlertStore.js";
import { buildRadarRouter } from "./api/radarRouter.js";

const port = Number(process.env.PORT ?? 3000);
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const walletSecretKey = process.env.WALLET_SECRET_KEY;
const dryRun = String(process.env.DRY_RUN ?? "true") === "true";
const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 15000);
const priceAlertIntervalMs = Number(process.env.PRICE_ALERT_INTERVAL_MS ?? 30000);
const walletAlertIntervalMs = Number(process.env.WALLET_ALERT_INTERVAL_MS ?? 30000);
const authRequired = String(process.env.AUTH_REQUIRED ?? "true") === "true";

const app = express();
app.use(cors());
app.use(express.json());

const ruleStore = new RuleStore();
await ruleStore.init();
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
const executor = new SolanaExecutor({ rpcUrl, walletSecretKey, dryRun });
const engine = new TradingEngine(ruleStore, priceFeed, executor, tickIntervalMs);
const priceAlertEngine = new PriceAlertEngine(priceAlertStore, priceAlertEventStore, priceFeed, priceAlertIntervalMs);
const walletAlertEngine = new WalletAlertEngine(rpcUrl, walletAlertStore, walletAlertEventStore, walletAlertIntervalMs);
const authMiddleware = buildAuthMiddleware(authStore);
const noAuthMiddleware: RequestHandler = (_req, _res, next) => next();
const maybeAuthMiddleware = authRequired ? authMiddleware : noAuthMiddleware;

app.get("/health", (_req, res) => {
  res.json({ ok: true, dryRun, tickIntervalMs, priceAlertIntervalMs, walletAlertIntervalMs, rpcUrl, authRequired });
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

if (authRequired) {
  app.use("/api/rules", buildAuthMiddleware(authStore), buildRulesRouter(ruleStore));
} else {
  app.use("/api/rules", buildRulesRouter(ruleStore));
}

app.post("/api/engine/tick", maybeAuthMiddleware, async (_req, res) => {
  await engine.tick();
  res.json({ ok: true });
});

app.post("/api/engine/start", maybeAuthMiddleware, (_req, res) => {
  engine.start();
  res.json({ ok: true, message: "engine started" });
});

app.post("/api/engine/stop", maybeAuthMiddleware, (_req, res) => {
  engine.stop();
  res.json({ ok: true, message: "engine stopped" });
});

app.use("/app", express.static(path.resolve("src/public")));

app.listen(port, () => {
  engine.start();
  priceAlertEngine.start();
  walletAlertEngine.start();
  console.log(
    `seeker alert server on :${port} (dryRun=${dryRun}, authRequired=${authRequired}, priceAlertIntervalMs=${priceAlertIntervalMs}, walletAlertIntervalMs=${walletAlertIntervalMs})`
  );
});
