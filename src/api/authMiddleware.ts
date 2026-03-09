import type { Request, Response, NextFunction } from "express";
import type { AuthStoreContract } from "../storage/contracts.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        wallet: string;
        token: string;
      };
    }
  }
}

export function buildAuthMiddleware(authStore: AuthStoreContract) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }

    const session = await authStore.verifySession(token);
    if (!session) {
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }

    req.auth = {
      wallet: session.wallet,
      token
    };
    next();
  };
}
