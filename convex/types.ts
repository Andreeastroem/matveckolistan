import { v } from "convex/values";
import { z } from "zod";

export const tagCategories = v.union(
  v.literal("diet"),
  v.literal("meal"),
  v.literal("difficulty"),
  v.literal("complex"),
  v.literal("cuisine"),
);

export const IngredientSchema = z.object({
  amount: z.array(z.number()).nullable(),
  unit: z.string().nullable(),
  name: z.string(),
});
export const InstructionSchema = z.object({
  stepNumber: z.number(),
  text: z.string(),
});
export const RecipeTagSchema = z.object({
  name: z.string().min(1),
  // If expanded:
  // Do not forget to add at the top of the file as well
  category: z.union([
    z.literal("diet"),
    z.literal("meal"),
    z.literal("difficulty"),
    z.literal("complex"),
    z.literal("cuisine"),
  ]),
});

export type Ingredient = z.infer<typeof IngredientSchema>;

export type Instruction = z.infer<typeof InstructionSchema>;

export type Tag = z.infer<typeof RecipeTagSchema>;
