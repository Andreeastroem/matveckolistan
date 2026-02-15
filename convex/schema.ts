import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { tagCategories } from "./types";

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export default defineSchema({
  ...authTables,

  recipeLinks: defineTable({
    slug: v.string(),
    name: v.string(),
    link: v.string(),
    isCrawled: v.boolean(),
    retries: v.number(),
  })
    .index("link", ["link"])
    .index("isCrawled", ["isCrawled"]),

  recipes: defineTable({
    recipeLinkId: v.id("recipeLinks"),
    slug: v.string(),
    name: v.string(),
    portionSize: v.optional(v.number()),
  }).index("slug", ["slug"]),

  recipeLinkUsers: defineTable({
    user: v.id("users"),
    recipeLinkId: v.id("recipeLinks"),
    created_at: v.number(),
    updated_at: v.optional(v.number()),
  })
    .index("user", ["user"])
    .index("recipeLink", ["recipeLinkId"]),

  recipeUsers: defineTable({
    user: v.id("users"),
    recipe: v.id("recipes"),
    created_at: v.number(),
    updated_at: v.optional(v.number()),
  })
    .index("user", ["user"])
    .index("recipe", ["recipe"]),

  ingredients: defineTable({
    amount: v.union(v.null(), v.array(v.float64())),
    name: v.string(),
    recipeLink: v.string(),
    unit: v.union(v.null(), v.string()),
    recipeId: v.id("recipes"),
  })
    .index("recipeId", ["recipeId"])
    .index("name", ["name"]),

  recipeInstructions: defineTable({
    recipeLink: v.string(),
    recipeLinkId: v.id("recipeLinks"),
    stepNumber: v.number(),
    text: v.string(),
    recipeId: v.id("recipes"),
  })
    .index("recipeLinkId", ["recipeLinkId"])
    .index("recipeId", ["recipeId"]),

  tags: defineTable({
    name: v.string(),
    category: tagCategories,
  })
    .index("name", ["name"])
    .index("category", ["category"]),

  recipeTag: defineTable({
    recipeId: v.id("recipes"),
    tagId: v.id("tags"),
  })
    .index("recipeId", ["recipeId"])
    .index("tagId", ["tagId"]),
});
