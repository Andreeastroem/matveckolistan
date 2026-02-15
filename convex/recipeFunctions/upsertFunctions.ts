import { GenericMutationCtx } from "convex/server";
import { DataModel, Id } from "../_generated/dataModel.js";
import { api, internal } from "../_generated/api.js";
import { inverseIntersection } from "./intersection";

import { Infer, v } from "convex/values";
import { Ingredient, Tag, TagCategories, tagCategories } from "../types.js";

const recipeVArgs = v.object({
  recipeLinkId: v.optional(v.id("recipeLinks")),
  id: v.optional(v.id("recipes")),
  name: v.string(),
  link: v.string(),
  ingredients: v.union(
    v.array(
      v.object({
        amount: v.union(v.array(v.number()), v.null()),
        unit: v.union(v.string(), v.null()),
        name: v.string(),
      }),
    ),
    v.null(),
  ),
  instructions: v.optional(
    v.union(
      v.array(
        v.object({
          stepNumber: v.number(),
          text: v.string(),
        }),
      ),
      v.null(),
    ),
  ),
  tags: v.array(
    v.object({
      category: tagCategories,
      name: v.string(),
    }),
  ),
});

export const addRecipeVArgs = v.object({
  recipeLinkId: v.id("recipeLinks"),
  recipe: recipeVArgs,
});

export const addRecipeLinkVArgs = v.object({
  recipeLinkId: v.id("recipeLinks"),
  recipes: v.array(recipeVArgs),
});

export type AddRecipeArgs = Infer<typeof addRecipeVArgs>;
export type AddRecipeLinksArgs = Infer<typeof addRecipeLinkVArgs>;

async function upsertInstructionsForRecipeLink(
  ctx: GenericMutationCtx<DataModel>,
  recipeLink: string,
  recipeLinkId: Id<"recipeLinks">,
  recipeId: Id<"recipes">,
  instructions: { stepNumber: number; text: string }[] | null,
) {
  if (!instructions) return;

  const existingInstructions = await ctx.db
    .query("recipeInstructions")
    .filter((q) => q.eq(q.field("recipeId"), recipeId))
    .collect();

  if (existingInstructions.length > 0) {
    //remove existing instructions
    await Promise.all(
      existingInstructions.map((instruction) => ctx.db.delete(instruction._id)),
    );
  }

  // Insert new instructions
  await Promise.all(
    (instructions ?? []).map(async (instruction) => {
      await ctx.db.insert("recipeInstructions", {
        recipeLink: recipeLink,
        text: instruction.text,
        stepNumber: instruction.stepNumber,
        recipeId: recipeId,
        recipeLinkId,
      });
    }),
  );
}

async function upsertIngredientsForRecipeLink(
  ctx: GenericMutationCtx<DataModel>,
  recipeLink: string,
  recipeId: Id<"recipes">,
  ingredients: Ingredient[] | null,
) {
  if (!ingredients) return;

  const existingIngredients = await ctx.db
    .query("ingredients")
    .filter((q) => q.eq(q.field("recipeId"), recipeId))
    .collect();

  if (existingIngredients.length === 0) {
    // Insert new ingredients
    await Promise.all(
      ingredients.map((ingredient) =>
        ctx.db.insert("ingredients", {
          name: ingredient.name,
          amount: ingredient.amount,
          unit: ingredient.unit,
          recipeLink: recipeLink,
          recipeId: recipeId,
        }),
      ),
    );
    return;
  }

  const uniqueIngredients = inverseIntersection<Ingredient>(
    existingIngredients,
    ingredients,
    (a, b) => a.name === b.name,
  );

  if (uniqueIngredients.length > 0) {
    // Update database
    // Delete existing ingredients
    await Promise.all(
      existingIngredients.map((ingredient) => ctx.db.delete(ingredient._id)),
    );

    // Insert new ingredients
    await Promise.all(
      ingredients.map((ingredient) =>
        ctx.db.insert("ingredients", {
          name: ingredient.name,
          amount: ingredient.amount,
          unit: ingredient.unit,
          recipeLink: recipeLink,
          recipeId: recipeId,
        }),
      ),
    );
  }
}

async function upsertTagsForRecipe(
  ctx: GenericMutationCtx<DataModel>,
  recipeId: Id<"recipes">,
  tags: Tag[],
) {
  const existingTags = await ctx.runQuery(api.recipe.getTagsForRecipeId, {
    recipeId,
  });

  const uniqueTags = inverseIntersection<{
    name: string;
    category: TagCategories;
  }>(tags, existingTags, (a, b) => {
    if (a.category === b.category) {
      return a.name === b.name;
    }
    return false;
  });

  if (uniqueTags.length === 0) {
    return;
  }

  await ctx.runMutation(internal.recipe.removeTagsForRecipeId, { recipeId });

  await ctx.runMutation(internal.recipe.addTagsForRecipeId, { recipeId, tags });
}

async function removeRecipe(
  ctx: GenericMutationCtx<DataModel>,
  recipeId: Id<"recipes">,
) {
  await ctx.db.delete(recipeId);
}

async function insertRecipe(
  ctx: GenericMutationCtx<DataModel>,
  recipeLinkId: Id<"recipeLinks">,
  slug: string,
  recipe: AddRecipeArgs["recipe"],
) {
  return ctx.db.insert("recipes", {
    name: recipe.name,
    recipeLinkId,
    slug,
  });
}

export async function upsertRecipeLink(
  ctx: GenericMutationCtx<DataModel>,
  args: AddRecipeLinksArgs,
) {
  const { recipes, recipeLinkId } = args;

  const existingRecipeLink = await ctx.db.get(recipeLinkId);

  if (existingRecipeLink) {
    const existingRecipes = await ctx.db
      .query("recipes")
      .filter((q) => q.eq(q.field("recipeLinkId"), recipeLinkId))
      .collect();

    const upsertRecipesPromises = recipes.map(async (recipe) => {
      const matchingRecipe = existingRecipes.find((r) => r._id === recipe.id);
      let recipeId;

      if (!matchingRecipe) {
        // new recipe
        const newRecipeId = await insertRecipe(
          ctx,
          recipeLinkId,
          existingRecipeLink.slug,
          recipe,
        );
        recipeId = newRecipeId;
      } else {
        recipeId = matchingRecipe._id;
      }

      await upsertIngredientsForRecipeLink(
        ctx,
        existingRecipeLink.link,
        recipeId,
        recipe?.ingredients ?? null,
      );
      await upsertInstructionsForRecipeLink(
        ctx,
        existingRecipeLink.link,
        recipeLinkId,
        recipeId,
        recipe?.instructions ?? null,
      );
      await upsertTagsForRecipe(ctx, recipeId, recipe.tags);

      if (matchingRecipe) {
        await ctx.db.patch(recipeId, {
          name: matchingRecipe.name,
        });
      }

      return recipeId;
    });

    const idsProcessed = (await Promise.allSettled(upsertRecipesPromises))
      .map((upsertRecipePromiseResult) => {
        if (upsertRecipePromiseResult.status === "fulfilled") {
          return upsertRecipePromiseResult.value;
        } else {
          return null;
        }
      })
      .filter((id) => id !== null);

    // Remove not processed existing recipes if they are not part of the recipe list
    const removeRecipesPromises = existingRecipes.map(
      async (existingRecipe) => {
        if (
          idsProcessed.findIndex(
            (processedId) => processedId === existingRecipe._id,
          ) === -1
        ) {
          // Check if recipe was part of the sent recipes (aka upserting failed)
          if (
            recipes.findIndex((recipe) => recipe.id === existingRecipe._id) ===
            -1
          ) {
            removeRecipe(ctx, existingRecipe._id);
          }
        }
      },
    );

    await Promise.allSettled(removeRecipesPromises);

    // Update the crawled recipeLink
    ctx.db.patch(recipeLinkId, {
      isCrawled: true,
    });

    return;
  }

  const insertRecipePromises = recipes.map((recipe) => {
    return insertRecipe(ctx, recipeLinkId, recipe.link, recipe);
  });

  await Promise.allSettled(insertRecipePromises);
}
