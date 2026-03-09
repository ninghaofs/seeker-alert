import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { PriceAlertEngine } from "../engine/priceAlertEngine.js";
import { WalletAlertEngine } from "../engine/walletAlertEngine.js";
import type {
  PriceAlertEventStoreContract,
  PriceAlertStoreContract,
  WalletAlertEventStoreContract,
  WalletAlertStoreContract
} from "../storage/contracts.js";
import type { PriceAlert, WalletAlert } from "../types/radar.js";
import { newId } from "../utils/id.js";

const createPriceAlertSchema = z.object({
  name: z.string().min(1),
  pair: z.string().min(3),
  inputMint: z.string().min(20),
  outputMint: z.string().min(20),
  direction: z.enum(["above", "below"]),
  targetPrice: z.number().positive()
});

const updatePriceAlertSchema = z.object({
  status: z.enum(["active", "paused"])
});

const solanaAddressSchema = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}, "invalid solana wallet address");

const createWalletAlertSchema = z.object({
  name: z.string().min(1),
  walletAddress: solanaAddressSchema,
  watchKind: z.enum(["receive_transfer", "send_transfer", "new_token", "receive_nft"])
});

const updateWalletAlertSchema = z.object({
  status: z.enum(["active", "paused"])
});

export function buildRadarRouter(
  priceAlertStore: PriceAlertStoreContract,
  priceAlertEventStore: PriceAlertEventStoreContract,
  priceAlertEngine: PriceAlertEngine,
  walletAlertStore: WalletAlertStoreContract,
  walletAlertEventStore: WalletAlertEventStoreContract,
  walletAlertEngine: WalletAlertEngine
): Router {
  const router = Router();

  router.get("/price-alerts", async (req, res) => {
    res.json(await priceAlertStore.listByOwner(req.auth!.wallet));
  });

  router.get("/status", async (req, res) => {
    const ownerWallet = req.auth!.wallet;
    res.json({
      ok: true,
      priceAlertIntervalMs: priceAlertEngine.getIntervalMs(),
      priceAlertCount: (await priceAlertStore.listByOwner(ownerWallet)).length,
      recentEventCount: (await priceAlertEventStore.listByOwner(ownerWallet, 10)).length,
      walletAlertIntervalMs: walletAlertEngine.getIntervalMs(),
      walletAlertCount: (await walletAlertStore.listByOwner(ownerWallet)).length
    });
  });

  router.get("/price-alert-events", async (req, res) => {
    res.json(await priceAlertEventStore.listByOwner(req.auth!.wallet));
  });

  router.get("/wallet-alerts", async (req, res) => {
    res.json(await walletAlertStore.listByOwner(req.auth!.wallet));
  });

  router.get("/wallet-alert-events", async (req, res) => {
    res.json(await walletAlertEventStore.listByOwner(req.auth!.wallet));
  });

  router.post("/price-alerts", async (req, res) => {
    const parsed = createPriceAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const now = new Date().toISOString();
    const alert: PriceAlert = {
      id: newId(),
      ownerWallet: req.auth!.wallet,
      name: parsed.data.name,
      pair: parsed.data.pair,
      inputMint: parsed.data.inputMint,
      outputMint: parsed.data.outputMint,
      direction: parsed.data.direction,
      targetPrice: parsed.data.targetPrice,
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    await priceAlertStore.upsert(alert);
    res.status(201).json(alert);
  });

  router.post("/price-alerts/check", async (_req, res) => {
    const checked = await priceAlertEngine.checkAll();
    res.json({ ok: true, alerts: checked });
  });

  router.patch("/price-alerts/:id", async (req, res) => {
    const parsed = updatePriceAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const current = await priceAlertStore.getByIdForOwner(req.params.id, req.auth!.wallet);
    if (!current) {
      res.status(404).json({ error: "price alert not found" });
      return;
    }

    const nextAlert: PriceAlert = {
      ...current,
      status: parsed.data.status,
      updatedAt: new Date().toISOString()
    };

    await priceAlertStore.upsert(nextAlert);
    res.json(nextAlert);
  });

  router.delete("/price-alerts/:id", async (req, res) => {
    const current = await priceAlertStore.getByIdForOwner(req.params.id, req.auth!.wallet);
    if (!current) {
      res.status(404).json({ error: "price alert not found" });
      return;
    }

    const removed = await priceAlertStore.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "price alert not found" });
      return;
    }

    res.json({ ok: true, id: req.params.id });
  });

  router.post("/wallet-alerts", async (req, res) => {
    const parsed = createWalletAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const now = new Date().toISOString();
    const alert: WalletAlert = {
      id: newId(),
      ownerWallet: req.auth!.wallet,
      name: parsed.data.name,
      walletAddress: parsed.data.walletAddress,
      watchKind: parsed.data.watchKind,
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    await walletAlertStore.upsert(alert);
    res.status(201).json(alert);
  });

  router.post("/wallet-alerts/check", async (_req, res) => {
    const checked = await walletAlertEngine.checkAll();
    res.json({ ok: true, alerts: checked });
  });

  router.patch("/wallet-alerts/:id", async (req, res) => {
    const parsed = updateWalletAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const current = await walletAlertStore.getByIdForOwner(req.params.id, req.auth!.wallet);
    if (!current) {
      res.status(404).json({ error: "wallet alert not found" });
      return;
    }

    const nextAlert: WalletAlert = {
      ...current,
      status: parsed.data.status,
      updatedAt: new Date().toISOString()
    };

    await walletAlertStore.upsert(nextAlert);
    res.json(nextAlert);
  });

  router.delete("/wallet-alerts/:id", async (req, res) => {
    const current = await walletAlertStore.getByIdForOwner(req.params.id, req.auth!.wallet);
    if (!current) {
      res.status(404).json({ error: "wallet alert not found" });
      return;
    }

    const removed = await walletAlertStore.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "wallet alert not found" });
      return;
    }

    res.json({ ok: true, id: req.params.id });
  });

  return router;
}
