import { z } from "zod";

const sideSchema = z.enum(["buy", "sell"]);

const baseRuleSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  inputMint: z.string().min(20),
  outputMint: z.string().min(20)
});

export const createDcaRuleSchema = baseRuleSchema.extend({
  strategyType: z.literal("dca"),
  config: z.object({
    side: sideSchema,
    amountPerInterval: z.number().positive(),
    intervalMinutes: z.number().int().positive(),
    maxRuns: z.number().int().positive().optional()
  })
});

export const createGridRuleSchema = baseRuleSchema.extend({
  strategyType: z.literal("grid"),
  config: z.object({
    lowerPrice: z.number().positive(),
    upperPrice: z.number().positive(),
    gridCount: z.number().int().min(2).max(200),
    amountPerGrid: z.number().positive()
  })
});

export const createLimitOrderRuleSchema = baseRuleSchema.extend({
  strategyType: z.literal("limit_order"),
  config: z.object({
    side: sideSchema,
    triggerPrice: z.number().positive(),
    amount: z.number().positive(),
    expiresAt: z.string().datetime().optional()
  })
});

export const createRuleSchema = z.discriminatedUnion("strategyType", [
  createDcaRuleSchema,
  createGridRuleSchema,
  createLimitOrderRuleSchema
]);

export const patchRuleSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type PatchRuleInput = z.infer<typeof patchRuleSchema>;
