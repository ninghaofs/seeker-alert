import express from "express";
import cors from "cors";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { buildAuthRouter } from "./api/authRouter.js";
import { buildAuthMiddleware } from "./api/authMiddleware.js";
import { buildRadarRouter } from "./api/radarRouter.js";
import { PriceAlertEngine } from "./engine/priceAlertEngine.js";
import { WalletAlertEngine } from "./engine/walletAlertEngine.js";
import { getFirebaseDb } from "./firebaseAdmin.js";
import { PriceFeed } from "./solana/priceFeed.js";
import { TokenRegistry } from "./solana/tokenRegistry.js";
import { FirestoreAuthStore } from "./storage/firestoreAuthStore.js";
import { FirestorePriceAlertEventStore } from "./storage/firestorePriceAlertEventStore.js";
import { FirestorePriceAlertStore } from "./storage/firestorePriceAlertStore.js";
import { FirestoreWalletAlertEventStore } from "./storage/firestoreWalletAlertEventStore.js";
import { FirestoreWalletAlertStore } from "./storage/firestoreWalletAlertStore.js";

const region = process.env.FIREBASE_FUNCTIONS_REGION ?? "asia-southeast1";
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const priceAlertIntervalMs = Number(process.env.PRICE_ALERT_INTERVAL_MS ?? 60000);
const walletAlertIntervalMs = Number(process.env.WALLET_ALERT_INTERVAL_MS ?? 60000);
const authRequired = String(process.env.AUTH_REQUIRED ?? "true") === "true";

const db = getFirebaseDb();
const authStore = new FirestoreAuthStore(db);
const priceAlertStore = new FirestorePriceAlertStore(db);
const priceAlertEventStore = new FirestorePriceAlertEventStore(db);
const walletAlertStore = new FirestoreWalletAlertStore(db);
const walletAlertEventStore = new FirestoreWalletAlertEventStore(db);
const priceFeed = new PriceFeed();
const tokenRegistry = new TokenRegistry();
const priceAlertEngine = new PriceAlertEngine(priceAlertStore, priceAlertEventStore, priceFeed, priceAlertIntervalMs);
const walletAlertEngine = new WalletAlertEngine(rpcUrl, walletAlertStore, walletAlertEventStore, walletAlertIntervalMs);
const authMiddleware = buildAuthMiddleware(authStore);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    platform: "firebase-functions",
    authRequired,
    priceAlertIntervalMs,
    walletAlertIntervalMs,
    rpcUrl
  });
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
app.use("/api/radar", authRequired ? authMiddleware : (_req, _res, next) => next(), buildRadarRouter(
  priceAlertStore,
  priceAlertEventStore,
  priceAlertEngine,
  walletAlertStore,
  walletAlertEventStore,
  walletAlertEngine
));

export const api = onRequest(
  {
    region,
    concurrency: 1,
    maxInstances: 1,
    timeoutSeconds: 60
  },
  app
);

export const priceAlertSweep = onSchedule(
  {
    region,
    schedule: "every 1 minutes",
    timeoutSeconds: 300
  },
  async () => {
    await priceAlertEngine.checkAll();
  }
);

export const walletAlertSweep = onSchedule(
  {
    region,
    schedule: "every 1 minutes",
    timeoutSeconds: 300
  },
  async () => {
    await walletAlertEngine.checkAll();
  }
);
