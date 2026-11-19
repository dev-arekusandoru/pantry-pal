import { Link } from "@tanstack/react-router";
import { VisuallyHidden } from "radix-ui";
import { useId, useState } from "react";
import { Button, Icon, SegmentedControl, Sheet, Skeleton, cx, toast, type SegmentOption } from "@/ui";
import { MeasureForm } from "../ingredients/MeasureForm";
import { unitText } from "../ingredients/units";
import { NutritionMatchSheet } from "./NutritionMatchSheet";
import { NO_VALUE, formatNutrient, formatWhole, lineDetail, partialLabel, type NutritionLine, type Nutrients } from "./nutrition";
import { useRecipeNutrition } from "./queries";
import styles from "./NutritionPanel.module.css";

type Basis = "serving" | "recipe";

const BASIS_OPTIONS: ReadonlyArray<SegmentOption<Basis>> = [
  { value: "serving", label: "Per serving" },
  { value: "recipe", label: "Whole recipe" },
];

const MAIN: ReadonlyArray<{ key: keyof Nutrients; label: string }> = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

const MINOR: ReadonlyArray<{ key: keyof Nutrients; label: string }> = [
  { key: "fiber", label: "Fiber" },
  { key: "sugar", label: "Sugar" },
  { key: "sodium", label: "Sodium" },
];

/** A value, or a dash that screen readers announce as "no data". */
function Value({ value, nutrient }: { value: number | null; nutrient: keyof Nutrients }) {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">{NO_VALUE}</span>
        <VisuallyHidden.Root>no data</VisuallyHidden.Root>
      </>
    );
  }
  return <>{formatNutrient(value, nutrient)}</>;
}

/** The unit a no_conversion line needs a measure for; a line with no unit counts pieces. */
function measureUnit(line: NutritionLine): string {
  const unit = line.unit?.trim();
  return unit ? unit : "count";
}

/**
 * Recipe nutrition from USDA FoodData Central: calories up front, the rest in a
 * quiet grid, and a per-ingredient breakdown that stays closed until asked for.
 * The breakdown is also where a wrong or missing food match is fixed.
 */
export function NutritionPanel({ slug }: { slug: string }) {
  const nutrition = useRecipeNutrition(slug);
  const [basis, setBasis] = useState<Basis>("serving");
  const [open, setOpen] = useState(false);
  const [matching, setMatching] = useState<NutritionLine | null>(null);
  const [measuring, setMeasuring] = useState<NutritionLine | null>(null);
  const headingId = useId();
  const breakdownId = useId();

  const data = nutrition.data;

  if (nutrition.isPending) {
    return (
      <section className={styles.panel} aria-labelledby={headingId} aria-busy="true">
        <h2 id={headingId} className={styles.title}>
          Nutrition
        </h2>
        <div className={styles.placeholder} aria-hidden="true">
          <Skeleton height={44} width={150} radius={12} />
          <Skeleton height={44} radius={12} />
        </div>
        <VisuallyHidden.Root role="status">Loading nutrition</VisuallyHidden.Root>
      </section>
    );
  }

  if (!data) {
    return (
      <section className={styles.panel} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.title}>
          Nutrition
        </h2>
        <p className={styles.note} role="alert">
          Couldn't load nutrition.{" "}
          <Button variant="ghost" className={styles.retry} onClick={() => void nutrition.refetch()} loading={nutrition.isFetching}>
            Try again
          </Button>
        </p>
      </section>
    );
  }

  const hasServing = data.perServing !== null;
  const shown: Nutrients | null = (basis === "serving" && hasServing ? data.perServing : data.total) ?? null;
  const partial = partialLabel(data.countedLines, data.missingLines);

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          Nutrition
        </h2>
        {hasServing && <SegmentedControl label="Show nutrition for" options={BASIS_OPTIONS} value={basis} onChange={setBasis} />}
      </div>

      <dl className={styles.stats}>
        <div className={styles.calories}>
          <dt>Calories</dt>
          <dd>
            <b>{shown?.calories == null ? <Value value={null} nutrient="calories" /> : formatWhole(shown.calories)}</b>
            <span> kcal</span>
          </dd>
        </div>
        <div className={cx(styles.group, styles.main)}>
          {MAIN.map(({ key, label }) => (
            <div key={key} className={styles.stat}>
              <dt>{label}</dt>
              <dd>
                <Value value={shown?.[key] ?? null} nutrient={key} />
              </dd>
            </div>
          ))}
        </div>
        <div className={cx(styles.group, styles.minor)}>
          {MINOR.map(({ key, label }) => (
            <div key={key} className={styles.stat}>
              <dt>{label}</dt>
              <dd>
                <Value value={shown?.[key] ?? null} nutrient={key} />
              </dd>
            </div>
          ))}
        </div>
      </dl>

      {partial !== null && <p className={styles.partial}>{partial}</p>}

      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={breakdownId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="caret" className={styles.chevron} />
        {open ? "Hide ingredient breakdown" : "Show ingredient breakdown"}
      </button>

      <div id={breakdownId} hidden={!open} className={styles.breakdown}>
        {open && (
          <ul className={styles.lines}>
            {data.lines.map((line) => (
              <li key={line.recipeIngredientId} className={styles.line} data-status={line.status}>
                <span className={styles.lineName}>
                  <Link to="/ingredients/$id" params={{ id: line.ingredientId }} className={styles.lineLink}>
                    {line.name}
                  </Link>
                </span>
                <span className={styles.lineKcal}>
                  <Value value={line.nutrients?.calories ?? null} nutrient="calories" />
                </span>
                <span className={styles.lineDetail}>{lineDetail(line)}</span>
                {line.status === "no_conversion" && line.hint !== undefined && <span className={styles.lineHint}>{line.hint}</span>}
                {line.status === "no_conversion" && (
                  <button
                    type="button"
                    className={styles.addMeasure}
                    onClick={() => setMeasuring(line)}
                    aria-label={`Add measure for ${unitText(measureUnit(line))} of ${line.name}`}
                  >
                    Add measure
                  </button>
                )}
                {line.status !== "optional" && (
                  <button
                    type="button"
                    className={styles.change}
                    onClick={() => setMatching(line)}
                    aria-label={`${line.food ? "Change match" : "Find match"} for ${line.name}`}
                  >
                    {line.food ? "Change match" : "Find match"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={styles.credit}>Source: {data.source}</p>

      <NutritionMatchSheet line={matching} onClose={() => setMatching(null)} />
      <Sheet
        open={measuring !== null}
        onClose={() => setMeasuring(null)}
        title={measuring === null ? "Add a measure" : `Add a measure for ${measuring.name}`}
      >
        {measuring !== null && (
          <>
            <p className={styles.measureIntro}>
              The weight of one {unitText(measureUnit(measuring))} lets {measuring.name} count in the nutrition of this recipe.
            </p>
            <MeasureForm
              ingredientId={measuring.ingredientId}
              unit={measureUnit(measuring)}
              title={`Weight of 1 ${unitText(measureUnit(measuring))}`}
              onCancel={() => setMeasuring(null)}
              onSaved={(measure) => {
                setMeasuring(null);
                toast.show({ message: `1 ${unitText(measure.unit)} of ${measuring.name} is saved. Nutrition is updated.` });
              }}
            />
          </>
        )}
      </Sheet>
    </section>
  );
}
