import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { RecipeTagCategorySchema } from "@/convex/types";
import { toJSONSchema } from "zod";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  if (!category) {
    return Response.json(
      { error: "Missing required query param: category" },
      { status: 400 },
    );
  }

  const parsedCategoryResult = RecipeTagCategorySchema.safeParse(category);

  if (!parsedCategoryResult.success) {
    return Response.json(
      {
        error:
          "Category must be one of: " + toJSONSchema(RecipeTagCategorySchema),
      },
      { status: 400 },
    );
  }

  const tags = await fetchQuery(api.recipe.getAllTagsByCategory, {
    // Cast to satisfy the generated Convex validator typings at runtime
    category: parsedCategoryResult.data,
  });

  return Response.json({ tags });
}
