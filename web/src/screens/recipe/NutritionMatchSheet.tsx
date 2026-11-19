import { Button, Sheet, toast } from "@/ui";
import { DefaultPortionField } from "../ingredients/DefaultPortionField";
import { FoodSearch } from "../ingredients/FoodSearch";
import type { NutritionLine } from "./nutrition";
import { useSetIngredientNutrition, type IngredientNutritionChoice } from "./queries";
import styles from "./NutritionMatchSheet.module.css";

export interface NutritionMatchSheetProps {
  /** The ingredient line being matched; null closes the sheet. */
  line: NutritionLine | null;
  onClose: () => void;
}

/** Pick the USDA food that supplies an ingredient's nutrition, clear it, or go back to the automatic match. */
export function NutritionMatchSheet({ line, onClose }: NutritionMatchSheetProps) {
  const set = useSetIngredientNutrition();

  function choose(target: NutritionLine, choice: IngredientNutritionChoice, message: string) {
    set.mutate(
      { ingredientId: target.ingredientId, choice },
      {
        onSuccess: () => {
          onClose();
          toast.show({ message });
        },
      },
    );
  }

  return (
    <Sheet
      open={line !== null}
      onClose={onClose}
      title="Match a USDA food"
      footer={
        <>
          <Button
            disabled={line === null || set.isPending}
            onClick={() => line && choose(line, { mode: "manual", fdcId: null }, `${line.name} has no food match`)}
          >
            No match
          </Button>
          <Button
            disabled={line === null || set.isPending}
            onClick={() => line && choose(line, { mode: "auto" }, `${line.name} uses the automatic match`)}
          >
            Auto match
          </Button>
        </>
      }
    >
      {line && (
        <Body
          key={line.recipeIngredientId}
          line={line}
          pending={set.isPending}
          onPick={(food) => choose(line, { mode: "manual", fdcId: food.fdcId }, `${line.name} now uses ${food.description}`)}
        />
      )}
    </Sheet>
  );
}

function Body({ line, pending, onPick }: { line: NutritionLine; pending: boolean; onPick: (food: { fdcId: number; description: string }) => void }) {
  return (
    <>
      <p className={styles.current}>
        <b>{line.name}</b> now uses: {line.food ? line.food.description : "no match"}
      </p>
      <p className={styles.scope}>
        The food you pick applies to {line.name} in every recipe. “No match” leaves it out of the totals.
      </p>
      {line.food && (
        <div className={styles.portion}>
          <DefaultPortionField ingredientId={line.ingredientId} />
        </div>
      )}
      <FoodSearch initialQuery={line.name} currentFdcId={line.food?.fdcId ?? null} pending={pending} onPick={onPick} />
    </>
  );
}
