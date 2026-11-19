import { useState, type FormEvent } from "react";
import { Button, Icon, Sheet, toast } from "@/ui";
import { DefaultPortionField } from "./DefaultPortionField";
import { FoodSearch } from "./FoodSearch";
import { IngredientPicker } from "./IngredientPicker";
import styles from "./Sheets.module.css";
import {
  useLinkFood,
  useMergeIngredient,
  useSplitIngredient,
  type IngredientView,
} from "./queries";
import { ingredientErrorMessage, splitNameParts, withAlternatives, type IngredientPick } from "./refs";

interface SheetProps {
  ingredient: IngredientView;
  onClose: () => void;
}

/**
 * Choose the USDA food that supplies an ingredient's nutrition. A food with portions
 * gets a second step to say what a plain count means (a large egg).
 */
export function LinkSheet({ ingredient, onClose }: SheetProps) {
  const link = useLinkFood();
  const [linked, setLinked] = useState<string | null>(null);

  if (linked !== null) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={`${ingredient.name} is linked`}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className={styles.sheetText}>{ingredient.name} now uses {linked}.</p>
        <DefaultPortionField ingredientId={ingredient.id} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={ingredient.nutrition?.fdcId == null ? `Link ${ingredient.name} to a USDA food` : `Change the USDA food of ${ingredient.name}`}>
      <p className={styles.sheetText}>
        The food gives {ingredient.name} its nutrition in every recipe. It does not change the name.
      </p>
      <FoodSearch
        initialQuery={splitNameParts(ingredient.name)[0] ?? ingredient.name}
        currentFdcId={ingredient.nutrition?.fdcId ?? null}
        pending={link.isPending}
        onPick={(food) =>
          link.mutate(
            { ingredientId: ingredient.id, fdcId: food.fdcId },
            {
              onSuccess: () => {
                if (food.portions.length > 0) {
                  setLinked(food.description);
                  return;
                }
                toast.show({ message: `${ingredient.name} now uses ${food.description}` });
                onClose();
              },
            },
          )
        }
      />
      {link.isError && (
        <p className={styles.problem} role="alert">
          {ingredientErrorMessage(link.error, "Could not link the food.")}
        </p>
      )}
    </Sheet>
  );
}

/** Replace a combined name ("Milk or water") by a main ingredient plus alternatives. */
export function SplitSheet({ ingredient, onClose, onSplit }: SheetProps & { onSplit: (main: IngredientPick) => void }) {
  const parts = splitNameParts(ingredient.name);
  const [main, setMain] = useState<IngredientPick | null>(null);
  const [alternatives, setAlternatives] = useState<Array<IngredientPick | null>>(() =>
    parts.length > 1 ? parts.slice(1).map(() => null) : [],
  );
  const split = useSplitIngredient();
  const chosen = alternatives.filter((alternative): alternative is IngredientPick => alternative !== null);
  const taken = (except?: IngredientPick | null) =>
    new Set([ingredient.id, ...(main && main !== except ? [main.id] : []), ...chosen.filter((c) => c !== except).map((c) => c.id)]);
  const canSplit = main !== null && alternatives.every((alternative) => alternative !== null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSplit || main === null) return;
    split.mutate(
      { ingredientId: ingredient.id, main, alternatives: chosen },
      {
        onSuccess: (result) => {
          const lines = result.moved.recipeLines + result.moved.alternativeLines;
          toast.show({
            message: `${ingredient.name} is now ${withAlternatives(main.name, chosen)}: ${lines} recipe ${lines === 1 ? "line" : "lines"} updated`,
          });
          onClose();
          onSplit(main);
        },
      },
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Split ${ingredient.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="review-split" variant="primary" disabled={!canSplit} loading={split.isPending}>
            Split
          </Button>
        </>
      }
    >
      <form id="review-split" className={styles.sheetForm} onSubmit={submit}>
        <p className={styles.sheetText}>
          Recipe lines that use “{ingredient.name}” get the main ingredient, with the others as alternatives. Pantry
          stock and shopping items move to the main ingredient, and “{ingredient.name}” is archived.
        </p>
        <IngredientPicker
          label="Main ingredient"
          value={main}
          onChange={setMain}
          initialQuery={parts[0] ?? ""}
          exclude={taken(main)}
          autoFocus
        />
        {alternatives.map((alternative, index) => (
          <div key={index} className={styles.alternative}>
            <IngredientPicker
              label={`Alternative ${index + 1}`}
              value={alternative}
              initialQuery={parts[index + 1] ?? ""}
              exclude={taken(alternative)}
              onChange={(pick) => setAlternatives((current) => current.map((item, i) => (i === index ? pick : item)))}
            />
            <Button
              variant="ghost"
              icon={<Icon name="trash" />}
              aria-label={`Remove alternative ${index + 1}`}
              onClick={() => setAlternatives((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button icon={<Icon name="plus" />} onClick={() => setAlternatives((current) => [...current, null])}>
          Add alternative
        </Button>
        {split.isError && (
          <p className={styles.problem} role="alert">
            {ingredientErrorMessage(split.error, "Could not split it.")}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/** Fold an ingredient into one that already exists. */
export function MergeSheet({
  ingredient,
  target,
  onClose,
  onMerged,
}: SheetProps & { target: IngredientPick | null; onMerged: (into: IngredientPick) => void }) {
  const [into, setInto] = useState<IngredientPick | null>(target);
  const merge = useMergeIngredient();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (into === null) return;
    merge.mutate(
      { ingredientId: ingredient.id, intoId: into.id },
      {
        onSuccess: () => {
          toast.show({ message: `${ingredient.name} merged into ${into.name}` });
          onClose();
          onMerged(into);
        },
      },
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Merge ${ingredient.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="review-merge" variant="primary" disabled={into === null} loading={merge.isPending}>
            Merge
          </Button>
        </>
      }
    >
      <form id="review-merge" className={styles.sheetForm} onSubmit={submit}>
        <p className={styles.sheetText}>
          Recipes, pantry stock and shopping items that use “{ingredient.name}” move to the ingredient you pick.
          “{ingredient.name}” becomes an alias of it, and the old ingredient is removed.
        </p>
        <IngredientPicker
          label="Merge into"
          value={into}
          onChange={setInto}
          initialQuery={target === null ? (splitNameParts(ingredient.name)[0] ?? "") : ""}
          exclude={new Set([ingredient.id])}
          autoFocus
        />
        {merge.isError && (
          <p className={styles.problem} role="alert">
            {ingredientErrorMessage(merge.error, "Could not merge it.")}
          </p>
        )}
      </form>
    </Sheet>
  );
}
