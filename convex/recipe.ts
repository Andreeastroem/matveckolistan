import { getAuthUserId } from "@convex-dev/auth/server";
import {
  mutation,
  query,
  internalAction,
  internalMutation,
} from "./_generated/server";
import { v } from "convex/values";

import { crawlRecipes } from "../crawler";
import {
  upsertRecipeLink,
  addRecipeLinkVArgs,
} from "./recipeFunctions/upsertFunctions";
import { paginationOptsValidator } from "convex/server";
import { tagCategories } from "./types";

export const getRecipeBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("slug", (q) => q.eq("slug", args.slug))
      .collect();

    if (recipes.length === 0) {
      return null;
    }

    const recipeLinkId = recipes.at(0)?.recipeLinkId;
    if (!recipeLinkId) {
      return null;
    }

    const recipeLink = await ctx.db.get(recipeLinkId);

    if (!recipeLink) return null;

    const fullRecipePromises = recipes.map(async (recipe) => {
      const ingredients = await ctx.db
        .query("ingredients")
        .filter((q) => q.eq(q.field("recipeId"), recipe._id))
        .collect();
      const instructions = await ctx.db
        .query("recipeInstructions")
        .filter((q) => q.eq(q.field("recipeId"), recipe._id))
        .collect();
      return {
        ...recipe,
        ingredients,
        instructions,
        recipeLink: recipeLink?.link,
      };
    });

    return (await Promise.allSettled(fullRecipePromises))
      .map((fullRecipePromise) => {
        if (fullRecipePromise.status === "fulfilled") {
          return fullRecipePromise.value;
        }
        return null;
      })
      .filter((fullRecipe) => fullRecipe !== null);
  },
});

export const getRecipeByLink = query({
  args: {
    link: v.string(),
  },
  handler: async (ctx, args) => {
    const recipeLink = await ctx.db
      .query("recipeLinks")
      .filter((q) => q.eq(q.field("link"), args.link))
      .first();

    if (recipeLink) {
      const recipes = await ctx.db
        .query("recipes")
        .filter((q) => q.eq(q.field("recipeLinkId"), recipeLink._id))
        .collect();

      const recipeWithData = await Promise.all(
        recipes.map(async (recipe) => {
          const ingredients = await ctx.db
            .query("ingredients")
            .filter((q) => q.eq(q.field("recipeId"), recipe._id))
            .collect();
          const instructions = await ctx.db
            .query("recipeInstructions")
            .filter((q) => q.eq(q.field("recipeId"), recipe._id))
            .collect();
          return { ...recipe, ingredients, instructions };
        }),
      );

      return recipeWithData;
    }

    return null;
  },
});

export const getRecipeById = query({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   throw new Error("Unauthorized");
    // }
    return await ctx.db
      .query("recipes")
      .filter((q) => q.eq(q.field("_id"), args.id))
      .first();
  },
});

export const getRecipeLinksByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const recipeLinkUsers = await ctx.db
      .query("recipeLinkUsers")
      .withIndex("user", (q) => q.eq("user", userId))
      .collect();

    const recipeLinkPromises = await Promise.allSettled(
      recipeLinkUsers.map((recipeLinkUser) => {
        return ctx.db.get(recipeLinkUser.recipeLinkId);
      }),
    );

    const recipeLinks = recipeLinkPromises
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((recipeLink) => recipeLink !== null);

    return recipeLinks;
  },
});

export const getRecipesByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const recipeUsers = await ctx.db
      .query("recipeUsers")
      .withIndex("user", (q) => q.eq("user", userId))
      .collect();
    const recipesPromises = await Promise.allSettled(
      recipeUsers.map(async (recipeUsers) => {
        return ctx.db.get(recipeUsers.recipe);
      }),
    );
    const recipes = recipesPromises
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    //filter out null values from recipes
    const filteredRecipes = recipes.filter((recipe) => recipe !== null);
    return filteredRecipes;
  },
});

export const getAllTagsByCategory = query({
  args: { category: tagCategories },
  handler: async (ctx, args) => {
    const tags = await ctx.db
      .query("tags")
      .filter((q) => q.eq(q.field("category"), args.category))
      .collect();

    return tags;
  },
});

export const addRecipeToBeCrawled = mutation({
  args: v.object({
    name: v.string(),
    link: v.string(),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      console.error("Not authenticated");
      return;
    }

    const existingRecipeLink = await ctx.db
      .query("recipeLinks")
      .filter((q) => q.eq(q.field("link"), args.link))
      .unique();

    if (!existingRecipeLink) {
      const recipeLinkId = await ctx.db.insert("recipeLinks", {
        ...args,
        retries: 0,
        isCrawled: false,
      });

      await ctx.db.insert("recipeLinkUsers", {
        recipeLinkId,
        user: userId,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      return;
    }

    if (existingRecipeLink.slug !== args.slug) {
      args.slug = existingRecipeLink.slug;
    }

    existingRecipeLink.isCrawled = false;

    await ctx.db.patch(existingRecipeLink._id, {
      ...existingRecipeLink,
    });

    const recipeLinkUser = await ctx.db
      .query("recipeLinkUsers")
      .filter((q) => q.eq(q.field("recipeLinkId"), existingRecipeLink._id))
      .first();

    if (recipeLinkUser) {
      await ctx.db.patch(recipeLinkUser._id, {
        ...recipeLinkUser,
        updated_at: Date.now(),
      });
    }
  },
});

export const getAllUncrawledRecipes = query({
  args: {},
  handler: async (ctx) => {
    const recipeLinks = await ctx.db
      .query("recipeLinks")
      .filter((q) =>
        q.and(q.eq(q.field("isCrawled"), false), q.lt(q.field("retries"), 5)),
      )
      .collect();

    return (
      await Promise.all(
        recipeLinks.map(async (recipeLink) => {
          const user = await ctx.db
            .query("recipeLinkUsers")
            .withIndex("recipeLink", (q) =>
              q.eq("recipeLinkId", recipeLink._id),
            )
            .unique();

          if (!user) {
            return null;
          }

          return {
            ...recipeLink,
            user: user.user,
          };
        }),
      )
    ).filter((uncrawledRecipe) => uncrawledRecipe !== null);
  },
});

export const getCrawledRecipeLinksPagination = query({
  args: {
    paginationOpts: paginationOptsValidator,
    filterOptions: v.optional(v.array(v.union(v.literal("category")))),
  },
  handler: async (ctx, args) => {
    const paginationResult = await ctx.db
      .query("recipeLinks")
      .filter((q) => q.eq(q.field("isCrawled"), true))
      .paginate(args.paginationOpts);

    return paginationResult;
  },
});

export const crawlRecipesAction = internalAction({
  args: {},
  handler: async (ctx) => {
    // Implementation for crawling recipes

    await crawlRecipes(ctx);

    return null;
  },
});

export const addRecipeToDatabase = internalMutation({
  args: addRecipeLinkVArgs,
  handler: async (ctx, args) => {
    await upsertRecipeLink(ctx, args);
  },
});

export const addRecipeLinkToDatabase = internalMutation({
  args: addRecipeLinkVArgs,
  handler: async (ctx, args) => {
    await upsertRecipeLink(ctx, args);
  },
});

export const recrawlAllRecipesAction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allRecipesLinks = await ctx.db.query("recipeLinks").collect();
    await Promise.all(
      allRecipesLinks.map((recipe) =>
        ctx.db.patch(recipe._id, { isCrawled: false }),
      ),
    );
  },
});

export const incrementRetryOnRecipeLink = internalMutation({
  args: {
    id: v.id("recipeLinks"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return;
    ctx.db.patch(args.id, {
      ...existing,
      retries: existing.retries + 1,
    });
  },
});
