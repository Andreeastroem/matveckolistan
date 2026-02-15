// modernCrawler.ts
import { getHTMLBody, RecipeType } from "./parser.js";
import { api, internal } from "../convex/_generated/api.js";
import { GenericActionCtx } from "convex/server";
import { DataModel, Id } from "../convex/_generated/dataModel.js";
import { CrawledRecipe, crawlRecipeFromHTMLBody } from "./openai";
import { IngredientSchema, TagCategories } from "../convex/types.js";

export async function crawlRecipes(ctx: GenericActionCtx<DataModel>) {
  const recipeLinksToCrawl = (
    await ctx.runQuery(api.recipe.getAllUncrawledRecipes)
  ).filter((uncrawledRecipes) => uncrawledRecipes !== null);

  const pendingCrawls = recipeLinksToCrawl.map(async (recipe) => {
    await ctx.runMutation(internal.recipe.incrementRetryOnRecipeLink, {
      id: recipe._id,
    });
    return await crawlRecipesFromUrl(
      ctx,
      recipe.link,
      recipe.name,
      recipe.link,
      recipe.user,
      recipe._id,
    );
  });

  const recipes = await Promise.allSettled(pendingCrawls);

  const validRecipes = recipes
    .map((recipe) => {
      if (recipe.status === "fulfilled") {
        return recipe.value;
      }
      console.error("Unable to crawl recipe:", recipe.reason);
      return null;
    })
    .filter((recipe) => recipe !== null);

  const recipesAddedToDatabase = await Promise.allSettled(
    validRecipes.map(async (validRecipeLink) => {
      const completeRecipes = validRecipeLink.filter((recipeLink) => {
        if (recipeLink.ingredients === null) {
          return false;
        }
        if (recipeLink.instructions === null) {
          return false;
        }
        if (recipeLink.tags.length === 0) {
          return false;
        }

        return true;
      });

      await ctx.runMutation(internal.recipe.addRecipeLinkToDatabase, {
        recipeLinkId: validRecipeLink[0].recipeLinkId,
        recipes: completeRecipes.map((recipe) => {
          return {
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
            tags: recipe.tags,
            name: recipe.name,
            link: recipe.link,
          };
        }),
      });
    }),
  );

  if (recipesAddedToDatabase.some((failed) => failed.status === "rejected")) {
    console.error("Some recipes failed to add to the database");
  }
}

export async function CrawlRecipeById(
  ctx: GenericActionCtx<DataModel>,
  id: Id<"recipeLinks">,
) {
  const recipeLink = await ctx.runQuery(internal.recipe.getRecipeLinkById, {
    id,
  });

  if (!recipeLink) return null;

  const recipes = await crawlRecipesFromUrl(
    ctx,
    recipeLink.link,
    recipeLink.name,
    recipeLink.link,
    recipeLink.user,
    recipeLink._id,
  );

  await insertRecipes(ctx, recipes);
}

async function insertRecipes(
  ctx: GenericActionCtx<DataModel>,
  recipes: CrawledRecipeWithUser[] | null,
) {
  if (!recipes) {
    return null;
  }

  await ctx.runMutation(internal.recipe.addRecipeLinkToDatabase, {
    recipeLinkId: recipes[0].recipeLinkId,
    recipes: recipes.map((recipe) => ({
      recipeLinkId: recipe.recipeLinkId,
      instructions: recipe.instructions,
      ingredients: recipe.ingredients,
      tags: recipe.tags,
      name: recipe.name,
      link: recipe.link,
    })),
  });
}

type CrawledRecipeWithUser = CrawledRecipe & {
  user: string;
  name: string;
  link: string;
  recipeLinkId: Id<"recipeLinks">;
};

async function crawlRecipesFromUrl(
  ctx: GenericActionCtx<DataModel>,
  url: string,
  name: string,
  link: string,
  user: string,
  recipeLinkId: Id<"recipeLinks">,
): Promise<CrawledRecipeWithUser[] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RecipeBot/1.0" },
    });

    if (!res.ok) {
      console.error(`Failed to fetch ${url}: ${res.status}`);
      return null;
    }

    const html = await res.text();

    const htmlBody = getHTMLBody(html);
    const existingTags = (
      await ctx.runQuery(internal.recipe.getAllTags)
    ).reduce<{ [K in TagCategories]: string[] }>(
      (tags, tag) => {
        if (!tags[tag.category].includes(tag.name)) {
          tags[tag.category].push(tag.name);
        }

        return tags;
      },
      { diet: [], meal: [], difficulty: [], complex: [], cuisine: [] },
    );

    if (htmlBody && htmlBody.length !== 0) {
      const AICrawledRecipes = await crawlRecipeFromHTMLBody(
        htmlBody,
        existingTags,
      );
      if (!AICrawledRecipes) {
        return null;
      }
      return AICrawledRecipes.map((recipe) => {
        return {
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          tags: recipe.tags,
          name: name,
          link: link,
          user: user,
          recipeLinkId,
        };
      });
    }

    // Unable to parse
    return null;
  } catch (err) {
    console.error(`Failed to fetch ${url}`, err);
    return null;
  }
}
