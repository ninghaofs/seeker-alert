import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { z } from "zod";
import type { AuthStoreContract } from "../storage/contracts.js";

const nonceQuerySchema = z.object({
  wallet: z.string().min(32)
});

const verifyBodySchema = z.object({
  wallet: z.string().min(32),
  nonce: z.string().min(8),
  signature: z.string().min(20)
});

const verifySignInBodySchema = z.object({
  wallet: z.string().min(32),
  nonce: z.string().min(8),
  signedMessageEncoded: z.string().min(20),
  signatureEncoded: z.string().min(20)
});

const logoutBodySchema = z.object({
  token: z.string().min(20)
});

export function buildAuthRouter(authStore: AuthStoreContract): Router {
  const router = Router();

  router.get("/nonce", async (req, res) => {
    const parsed = nonceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const wallet = parsed.data.wallet;
    if (!isValidPubkey(wallet)) {
      res.status(400).json({ error: "invalid wallet address" });
      return;
    }

    const nonce = await authStore.issueNonce(wallet);
    const message = `seeker alert login\nwallet=${wallet}\nnonce=${nonce}`;

    res.json({ wallet, nonce, message, expiresInSec: 300 });
  });

  router.post("/verify", async (req, res) => {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { wallet, nonce, signature } = parsed.data;
    if (!isValidPubkey(wallet)) {
      res.status(400).json({ error: "invalid wallet address" });
      return;
    }

    const nonceOk = await authStore.consumeNonce(wallet, nonce);
    if (!nonceOk) {
      res.status(401).json({ error: "nonce invalid or expired" });
      return;
    }

    const message = `seeker alert login\nwallet=${wallet}\nnonce=${nonce}`;
    const sigOk = verifySignature(wallet, message, signature);
    if (!sigOk) {
      res.status(401).json({ error: "signature verification failed" });
      return;
    }

    const token = await authStore.issueSession(wallet);
    res.json({ token, wallet, expiresInSec: 86400 });
  });

  router.post("/verify-signin", async (req, res) => {
    const parsed = verifySignInBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { wallet, nonce, signedMessageEncoded, signatureEncoded } = parsed.data;
    if (!isValidPubkey(wallet)) {
      res.status(400).json({ error: "invalid wallet address" });
      return;
    }

    const nonceOk = await authStore.consumeNonce(wallet, nonce);
    if (!nonceOk) {
      res.status(401).json({ error: "nonce invalid or expired" });
      return;
    }

    const signedMessageBytes = decodeMaybeBase64OrBase64Url(signedMessageEncoded);
    const signatureBytes = decodeMaybeBase64OrBase64Url(signatureEncoded);

    if (!signedMessageBytes || !signatureBytes) {
      res.status(400).json({ error: "invalid base64 payload" });
      return;
    }

    const sigOk = verifyBytes(wallet, signedMessageBytes, signatureBytes);
    if (!sigOk) {
      res.status(401).json({ error: "signature verification failed" });
      return;
    }

    const signedMessageText = new TextDecoder().decode(signedMessageBytes);
    if (!signedMessageText.includes(nonce) || !signedMessageText.includes(wallet)) {
      res.status(401).json({ error: "signed message content mismatch" });
      return;
    }

    const token = await authStore.issueSession(wallet);
    res.json({ token, wallet, expiresInSec: 86400 });
  });

  router.post("/logout", async (req, res) => {
    const parsed = logoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await authStore.revokeSession(parsed.data.token);
    res.json({ ok: true });
  });

  return router;
}

function isValidPubkey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function verifySignature(wallet: string, message: string, signatureBase58: string): boolean {
  try {
    const pk = new PublicKey(wallet).toBytes();
    const sig = bs58.decode(signatureBase58);
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

function verifyBytes(wallet: string, messageBytes: Uint8Array, signatureBytes: Uint8Array): boolean {
  try {
    const pk = new PublicKey(wallet).toBytes();
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pk);
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

function decodeMaybeBase64OrBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return decodeBase64(`${normalized}${padding}`);
}
