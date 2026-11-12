import { formatAmount, type RecipeStepLink } from "../recipe/lib";

export interface StepPillLine {
  id: string;
  scalingExempt: boolean;
}

export interface StepPillScaled {
  recipeIngredientId: string;
  qty: number | null;
  qtyMax: number | null;
  unit: string | null;
}

export interface StepPill {
  id: string;
  name: string;
  imageUrl: string | null;
  amount: string;
  prepNote: string | null;
}

/**
 * Pills for one step. A link scales by the servings factor like its line; a
 * null link qty follows the whole (already scaled) line. Scaling-exempt lines
 * keep their written amount.
 */
export function stepPillRows(
  links: RecipeStepLink[],
  lines: StepPillLine[],
  scaled: StepPillScaled[],
  servings: number,
  recipeServings: number,
): StepPill[] {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const scaledById = new Map(scaled.map((item) => [item.recipeIngredientId, item]));
  const factor = servings > 0 && recipeServings > 0 ? servings / recipeServings : 1;

  return links.map((link) => {
    const line = lineById.get(link.recipeIngredientId);
    const scaledLine = scaledById.get(link.recipeIngredientId);
    const exempt = line?.scalingExempt ?? false;
    const qty = exempt
      ? link.qty
      : link.qty === null
        ? (scaledLine?.qty ?? null)
        : link.qty * factor;
    const qtyMax = !exempt && link.qty === null ? (scaledLine?.qtyMax ?? null) : null;
    return {
      id: link.id,
      name: link.ingredientName,
      imageUrl: link.imageUrl,
      amount: formatAmount(qty, qtyMax, link.unit),
      prepNote: link.prepNote,
    };
  });
}
