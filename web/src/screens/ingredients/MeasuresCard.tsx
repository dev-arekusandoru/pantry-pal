import { useState } from "react";
import { errorMessage } from "@/api";
import { Button, Card, Icon, Pill, toast, type PillProps } from "@/ui";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import styles from "./Ingredient.module.css";
import { MeasureForm } from "./MeasureForm";
import { useDeleteMeasure, type IngredientDetail } from "./queries";
import { SOURCE_LABEL, formatGramsOf, unitText, type Measure } from "./units";

const SOURCE_TONE: Record<Measure["source"], NonNullable<PillProps["tone"]>> = {
  usda: "blue",
  usda_estimated: "butter",
  user: "pistachio",
};

/** What one unit of this ingredient weighs: USDA sizes, estimated sizes and the household's own. */
export function MeasuresCard({ ingredient }: { ingredient: IngredientDetail }) {
  const remove = useDeleteMeasure();
  /** Unit being edited, or "" for the add form. */
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Measure | null>(null);
  const archived = ingredient.archivedAt !== null;

  function drop(measure: Measure, message: string) {
    remove.mutate(
      { ingredientId: ingredient.id, unit: measure.unit },
      {
        onSuccess: () => {
          setDeleting(null);
          toast.show({ message });
        },
        onError: (error) => {
          setDeleting(null);
          toast.error(errorMessage(error));
        },
      },
    );
  }

  return (
    <Card as="section" radius="xl" className={styles.card} aria-labelledby="measures-h">
      <h2 id="measures-h" className={styles.heading}>
        Measures
      </h2>
      <p className={styles.hint}>
        A measure is the weight of one unit of {ingredient.name} in grams. Recipes, the pantry, shopping lists and nutrition use
        it to turn a cup into ounces, or a clove into grams. Your own measure replaces the USDA one for the same unit.
      </p>

      {ingredient.measures.length === 0 ? (
        <p className={styles.none}>No measures yet.</p>
      ) : (
        <ul className={styles.measureList} aria-label={`Measures of ${ingredient.name}`}>
          {ingredient.measures.map((measure) =>
            editing === measure.unit ? (
              <li key={measure.unit}>
                <MeasureForm
                  ingredientId={ingredient.id}
                  unit={measure.unit}
                  initialGrams={measure.grams}
                  title={`Change the measure for ${unitText(measure.unit)}`}
                  saveLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSaved={(saved) => {
                    setEditing(null);
                    toast.show({ message: `1 ${unitText(saved.unit)} of ${ingredient.name} is now ${formatGramsOf(saved.grams)}` });
                  }}
                />
              </li>
            ) : (
              <li key={measure.unit} className={styles.measureRow}>
                <span className={styles.measureUnit}>{unitText(measure.unit)}</span>
                <span className={styles.measureGrams}>{formatGramsOf(measure.grams)}</span>
                <Pill tone={SOURCE_TONE[measure.source]}>{SOURCE_LABEL[measure.source]}</Pill>
                {measure.source === "user" && measure.usdaGrams !== null && (
                  <span className={styles.measureNote}>USDA: {formatGramsOf(measure.usdaGrams)}</span>
                )}
                {measure.source === "usda_estimated" && (
                  <span className={styles.measureNote}>Borrowed from a similar food</span>
                )}
                {measure.note !== null && <span className={styles.measureNote}>{measure.note}</span>}
                {!archived && (
                  <span className={styles.measureActions}>
                    <Button aria-label={`${measure.source === "user" ? "Edit" : "Change"} the measure for ${unitText(measure.unit)}`} onClick={() => setEditing(measure.unit)}>
                      {measure.source === "user" ? "Edit" : "Change"}
                    </Button>
                    {measure.source === "user" &&
                      (measure.usdaGrams !== null ? (
                        <Button
                          aria-label={`Reset ${unitText(measure.unit)} to USDA`}
                          loading={remove.isPending && remove.variables?.unit === measure.unit}
                          disabled={remove.isPending}
                          onClick={() => drop(measure, `${unitText(measure.unit)} is back to the USDA weight`)}
                        >
                          Reset to USDA
                        </Button>
                      ) : (
                        <Button
                          variant="dangerGhost"
                          aria-label={`Delete the measure for ${unitText(measure.unit)}`}
                          icon={<Icon name="trash" />}
                          disabled={remove.isPending}
                          onClick={() => setDeleting(measure)}
                        >
                          Delete
                        </Button>
                      ))}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {!archived &&
        (editing === "" ? (
          <MeasureForm
            ingredientId={ingredient.id}
            onCancel={() => setEditing(null)}
            onSaved={(saved) => {
              setEditing(null);
              toast.show({ message: `1 ${unitText(saved.unit)} of ${ingredient.name} is ${formatGramsOf(saved.grams)}` });
            }}
          />
        ) : (
          <div className={styles.actions}>
            <Button icon={<Icon name="plus" />} onClick={() => setEditing("")}>
              Add a measure
            </Button>
          </div>
        ))}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting === null ? "Delete the measure?" : `Delete the measure for ${unitText(deleting.unit)}?`}
        confirmLabel="Delete"
        cancelLabel="Keep it"
        pending={remove.isPending}
        onConfirm={() => deleting !== null && drop(deleting, `Measure for ${unitText(deleting.unit)} deleted`)}
      >
        Lines and pantry amounts in {deleting === null ? "this unit" : unitText(deleting.unit)} stop converting for {ingredient.name} until you add the measure again.
      </ConfirmDialog>
    </Card>
  );
}
