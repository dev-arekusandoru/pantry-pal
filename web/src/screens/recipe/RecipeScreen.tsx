import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Emoji, EmptyState, ErrorState, Icon, IconButton, Pill, SegmentedControl, Skeleton, Stepper, buttonClass, ingredientEmoji, type SegmentOption } from "@/ui";
import { formatDuration, stepSeconds } from "./duration";
import { formatAmount, formatDay, formatMinutes, formatNumber, haveIngredient, type Have, type MealType } from "./lib";
import { RecipePhoto } from "./RecipePhoto";
import { isNotFound, useAvailability, usePlannedCooks, useRecipe, useScaledIngredients, useSetRecipeStatus } from "./queries";
import type { EditableStatus } from "./status";
import { isResumable, readCookProgress } from "../cook/progress";
import styles from "./RecipeScreen.module.css";

/** The permanent thumbs control: up keeps it in rotation, down never cooks it again. */
const STATUS_OPTIONS: ReadonlyArray<SegmentOption<EditableStatus>> = [
  { value: "rotation", label: "Rotation", icon: <Emoji code="1F44D" size={16} /> },
  { value: "want_to_try", label: "Want to try" },
  { value: "never", label: "Never", icon: <Emoji code="1F44E" size={16} /> },
];

export interface RecipeScreenProps {
  slug: string;
  /** Planned cook this view was opened from (`?cookEvent=`). */
  cookEvent?: string;
  /** Servings carried over from cook mode (`?servings=`). */
  servings?: number;
}

interface Row {
  id: string;
  group: string | null;
  name: string;
  prepNote: string | null;
  optional: boolean;
  amount: string;
  have: Have | null;
}

const HAVE_LABEL: Record<Have, string> = {
  have: "In your pantry",
  some: "Some in your pantry, not enough",
  none: "Not in your pantry",
  unknown: "Pantry amount unknown",
};

export function RecipeScreen({ slug, cookEvent, servings: servingsParam }: RecipeScreenProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const recipe = useRecipe(slug);
  const r = recipe.data;
  const setStatus = useSetRecipeStatus();

  const planned = usePlannedCooks(r?.id);
  const plannedCook = cookEvent !== undefined ? planned.data?.find((c) => c.id === cookEvent) : undefined;
  // Only carry a cook event into cook mode while it is still planned; a stale id
  // from an old link would fail at Finish.
  const plannedCookId = plannedCook?.id ?? (planned.isPending ? cookEvent : undefined);
  // Don't scale twice when the planned servings are about to arrive.
  const waitingForPlan = cookEvent !== undefined && servingsParam === undefined && planned.isPending && r !== undefined;

  const [picked, setPicked] = useState<number | null>(null);
  const servings = r === undefined || waitingForPlan ? undefined : (picked ?? servingsParam ?? plannedCook?.plannedServings ?? r.servings);

  const scaled = useScaledIngredients(slug, servings);
  const availability = useAvailability();
  // Saved cook-mode position for this recipe; shown as a resume affordance.
  const progress = useMemo(() => readCookProgress(slug), [slug]);

  const rows = useMemo<Row[]>(() => {
    if (!r) return [];
    const scaledById = new Map(scaled.data?.items.map((s) => [s.recipeIngredientId, s]));
    const haveByIngredient = new Map(availability.data?.items.map((a) => [a.ingredientId, a]));
    return r.ingredients.map((ri) => {
      const s = scaledById.get(ri.id) ?? (servings === r.servings ? ri : undefined);
      const qty = s?.qty ?? null;
      return {
        id: ri.id,
        group: ri.groupLabel,
        name: ri.ingredient.name,
        prepNote: ri.prepNote,
        optional: ri.optional,
        amount: s ? formatAmount(qty, s.qtyMax, s.unit) : "",
        have: availability.data
          ? haveIngredient({ ingredientId: ri.ingredientId, qty, unit: s?.unit ?? null }, haveByIngredient.get(ri.ingredientId))
          : null,
      };
    });
  }, [r, scaled.data, availability.data, servings]);

  function goBack() {
    if (canGoBack) router.history.back();
    else void router.navigate({ to: "/recipes" });
  }

  if (recipe.isPending) return <RecipeSkeleton />;
  if (!r || recipe.isError) {
    if (isNotFound(recipe.error)) {
      return (
        <EmptyState
          emoji="1F37D"
          title="Recipe not found"
          action={
            <Link to="/recipes" className={buttonClass({ variant: "primary" })}>
              Back to recipes
            </Link>
          }
        >
          It may have been removed.
        </EmptyState>
      );
    }
    return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  }

  const time = formatMinutes(r.totalMinutes ?? (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0));
  const shownServings = servings ?? r.servings;
  const savedProgress = isResumable(progress, r.steps.length) ? progress : null;
  const missing = rows.filter((x) => !x.optional && x.have === "none");
  const low = rows.filter((x) => !x.optional && x.have === "some");

  return (
    <article className={styles.page}>
      <div className={styles.hero}>
        <RecipePhoto imageUrl={r.imageUrl} mealTypes={r.mealTypes as MealType[]} className={styles.photo} priority />
        <IconButton className={styles.back} label="Back" icon={<Icon name="back" />} onClick={goBack} />
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>{r.title}</h1>
        <p className={styles.meta}>
          {time && (
            <span>
              <Icon name="clock" /> {time}
            </span>
          )}
          <span>
            <Icon name="people" /> Makes {formatNumber(r.servings)}
          </span>
          {r.cuisine && <span>{r.cuisine}</span>}
        </p>
        {r.description && <p className={styles.desc}>{r.description}</p>}
        {r.sourceUrl !== null && /^https?:\/\//i.test(r.sourceUrl) && (
          <a
            className={styles.source}
            href={r.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="recipes" size={17} />
            View original recipe{r.sourceName ? ` on ${r.sourceName}` : ""}
          </a>
        )}

        <div className={styles.badges}>
          {plannedCook && (
            <Pill tone="butter" icon={<Icon name="week" />}>
              Planned for {formatDay(plannedCook.cookDate)}
            </Pill>
          )}
          {r.tags.map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </div>

        {r.status !== "archived" && (
          <div className={styles.status}>
            <SegmentedControl
              label="Recipe status"
              options={STATUS_OPTIONS}
              value={r.status}
              onChange={(status) => {
                if (status !== r.status) setStatus.mutate({ slug: r.slug, status });
              }}
            />
          </div>
        )}

        <section className={styles.ings} aria-labelledby="ings-h">
          <div className={styles.ingsHead}>
            <h2 id="ings-h">Ingredients</h2>
            <Stepper
              label="Servings"
              value={formatNumber(shownServings)}
              unit="servings"
              onDecrement={() => setPicked(Math.max(1, shownServings - 1))}
              onIncrement={() => setPicked(shownServings + 1)}
              disableDecrement={shownServings <= 1 || servings === undefined}
              disableIncrement={servings === undefined}
            />
          </div>

          {availability.data && (
            <div className={styles.summary} data-state={missing.length + low.length === 0 ? "ok" : "need"}>
              <b>What am I missing?</b>
              {missing.length + low.length === 0 ? (
                <p>You have everything for {formatNumber(shownServings)} servings.</p>
              ) : (
                <>
                  {missing.length > 0 && (
                    <p>
                      <span>Need to buy:</span> {missing.map((x) => x.name).join(", ")}
                    </p>
                  )}
                  {low.length > 0 && (
                    <p>
                      <span>Running short:</span> {low.map((x) => x.name).join(", ")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <ul className={styles.ingList} aria-busy={scaled.isFetching || undefined}>
            {rows.map((row, i) => (
              <li key={row.id}>
                {row.group && row.group !== rows[i - 1]?.group && <p className={styles.group}>{row.group}</p>}
                <div className={styles.ing}>
                  <span className={styles.ingEmoji} aria-hidden="true">
                    <Emoji code={ingredientEmoji(row.name)} size={20} />
                  </span>
                  <span className={styles.ingAmount}>{row.amount}</span>
                  <span className={styles.ingName}>
                    {row.name}
                    {row.prepNote && <small>, {row.prepNote}</small>}
                    {row.optional && <small> (optional)</small>}
                  </span>
                  {row.have && row.have !== "unknown" ? (
                    <span className={styles.have} data-have={row.have} role="img" aria-label={HAVE_LABEL[row.have]} title={HAVE_LABEL[row.have]}>
                      {row.have === "have" ? <Icon name="check" /> : row.have === "some" ? "½" : <Icon name="plus" />}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {availability.data && (
            <p className={styles.legend}>
              <span className={styles.have} data-have="have" aria-hidden="true">
                <Icon name="check" />
              </span>
              in your pantry
              <span className={styles.have} data-have="some" aria-hidden="true">
                ½
              </span>
              not enough
              <span className={styles.have} data-have="none" aria-hidden="true">
                <Icon name="plus" />
              </span>
              to buy
            </p>
          )}
        </section>

        <section className={styles.method} aria-labelledby="method-h">
          <h2 id="method-h">Method</h2>
          <ol className={styles.steps}>
            {r.steps.map((step, i) => {
              const secs = stepSeconds(step);
              return (
                <li key={step.id}>
                  <span className={styles.stepNum}>{i + 1}</span>
                  <div>
                    {step.groupLabel && step.groupLabel !== r.steps[i - 1]?.groupLabel && <p className={styles.group}>{step.groupLabel}</p>}
                    <p>
                      {step.text}
                      {secs !== null && (
                        <span className={styles.dur}>
                          <Icon name="timer" /> {formatDuration(secs)}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <div className={styles.bar}>
        {savedProgress && (
          <Link
            to="/recipes/$slug/cook"
            params={{ slug: r.slug }}
            search={{
              servings: savedProgress.servings,
              ...(savedProgress.cookEvent !== undefined ? { cookEvent: savedProgress.cookEvent } : {}),
              resume: true,
              from: "recipe",
            }}
            className={buttonClass({ size: "lg", className: styles.cta })}
          >
            <Icon name="undo" />
            Resume at step {savedProgress.step + 1}
          </Link>
        )}
        <Link
          to="/recipes/$slug/cook"
          params={{ slug: r.slug }}
          search={{
            servings: shownServings,
            ...(plannedCookId !== undefined ? { cookEvent: plannedCookId } : {}),
            from: "recipe",
          }}
          className={buttonClass({ variant: "primary", size: "lg", className: styles.cta })}
          aria-disabled={servings === undefined || undefined}
        >
          <Icon name="flame" />
          Start cooking
        </Link>
      </div>
    </article>
  );
}

function RecipeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading recipe" className={styles.page}>
      <Skeleton height={280} radius={34} />
      <div className={styles.body}>
        <Skeleton height={44} width="70%" />
        <div style={{ height: 12 }} />
        <Skeleton height={20} width="50%" />
        <div style={{ height: 24 }} />
        <Skeleton height={320} radius={32} />
      </div>
    </div>
  );
}
