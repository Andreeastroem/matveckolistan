import OpenAI from "openai";
import { z } from "zod";
import {
  IngredientSchema,
  InstructionSchema,
  RecipeTagSchema,
} from "../../convex/types";

const client = new OpenAI();

const recipeSchema = z.object({
  ingredients: z.array(IngredientSchema),
  instructions: z.array(InstructionSchema),
  tags: z.array(RecipeTagSchema),
});

const ingredientsCaveats = `
There are some caveats to the ingredients amount field:
    - If the amount is a range, e.g. "2-3", it should be represented as an array of numbers, e.g. [2, 3]
    - If the amount is a fraction, e.g. "1/2", it should be represented as an array of numbers, e.g. [0.5]
    - If the amount is a mixed number, e.g. "1 1/2", it should be represented as an array of numbers, e.g. [1.5]
    - If the amount is in multiple parts, e.g. "2-3 or 4", it should be represented as an array of numbers, e.g. [2, 3, 4]
    - If the amount is not specified or cannot be determined, it should be null
    - If the amount is a word, e.g. "a few", it should be null
`;

const instructionsCaveats = `
There are some caveats regarding the instructions field:
    - There is not always a number to the instruction, it should be inferred from the context at what stage we are currently are
    - I do not want the text to be altered, it should be copied as is. The whole step text must be unaltered.
    - If there are several ways to approach the process (for example oven or fryer) choose one - preferably the recommended one. If there is no recommended use the most accessible (meaning the one with less specialised cooking utensils)
`;

const tagInstructions = `
  Deduce from the ingredients and instructions what the most appropriate tags should be, there should be between 1-3 tags for each category. 
  
`;

const outputFormatSchema = z.object({
  recipes: z.array(recipeSchema).nullable(),
});

export async function crawlRecipeFromHTMLBody(
  htmlBody: string,
): Promise<z.infer<typeof outputFormatSchema>["recipes"] | null> {
  try {
    const response = await client.responses.create({
      model: "gpt-5-nano",
      input: [
        {
          role: "system",
          content:
            "You will extract the recipes from the supplied html content, do not add anything not supplied in the response format. If there are multiple recipes you will connect the correct ingredients to the correct recipe",
        },
        {
          role: "system",
          content: "If no recipe can be parsed then return null",
        },
        {
          role: "system",
          content: ingredientsCaveats,
        },
        {
          role: "system",
          content: instructionsCaveats,
        },
        {
          role: "user",
          content: `This is the html content: ${htmlBody}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          schema: z.toJSONSchema(outputFormatSchema),
          name: "recipe",
        },
      },
    });

    const validation = outputFormatSchema.safeParse(
      typeof response.output_text === "string"
        ? JSON.parse(response.output_text)
        : response.output_text,
    );

    if (!validation.success) {
      console.error("Validation errors:", validation.error.message);
      throw Error(`Unable to parse the output: ${response.output_text}`);
    }

    return validation.data.recipes;
  } catch (error) {
    console.error(error);
    return null;
  }
}
