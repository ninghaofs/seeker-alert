import { Router } from "express";
import { createRuleSchema, patchRuleSchema, type CreateRuleInput } from "../types/api.js";
import type { TradingRule } from "../types/trading.js";
import { RuleStore } from "../storage/ruleStore.js";
import { newId } from "../utils/id.js";

export function buildRulesRouter(ruleStore: RuleStore): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(ruleStore.list());
  });

  router.post("/", async (req, res) => {
    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const rule = createRule(parsed.data);
    await ruleStore.upsert(rule);
    res.status(201).json(rule);
  });

  router.patch("/:id", async (req, res) => {
    const rule = ruleStore.findById(req.params.id);
    if (!rule) {
      res.status(404).json({ error: "rule not found" });
      return;
    }

    const parsed = patchRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    Object.assign(rule, parsed.data);
    rule.updatedAt = new Date().toISOString();
    await ruleStore.upsert(rule);

    res.json(rule);
  });

  router.delete("/:id", async (req, res) => {
    const ok = await ruleStore.delete(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "rule not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}

function createRule(input: CreateRuleInput): TradingRule {
  const now = new Date().toISOString();
  const common = {
    id: newId(),
    name: input.name,
    enabled: input.enabled,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    createdAt: now,
    updatedAt: now
  };

  if (input.strategyType === "dca") {
    return {
      ...common,
      strategyType: "dca",
      config: input.config,
      state: { runs: 0 }
    };
  }

  if (input.strategyType === "grid") {
    return {
      ...common,
      strategyType: "grid",
      config: input.config,
      state: { triggeredLevels: {} }
    };
  }

  return {
    ...common,
    strategyType: "limit_order",
    config: input.config,
    state: { triggered: false }
  };
}
