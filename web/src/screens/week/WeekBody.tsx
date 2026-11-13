import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, Icon, IconButton, Pal, Pill, Sticker, buttonClass, cx, toast } from "@/ui";
import { readSweepCount, useTreat, weekMissions } from "@/game/missions";
import { useUndoCook } from "../cook/queries";
import { addDays, monthDay, weekdayName } from "./dates";
import {
  MEAL_EMOJI,
  MEAL_LABEL,
  canAddDish,
  canRemoveDish,
  dishTitles,
  mealGroups,
  prepDueLabel,
  recipeSlug,
  slotName,
  slotNote,
  slotState,
  swapPlanFor,
  type AvailabilityLine,
  type MealType,
  type PlanDay,
  type PlanView,
  type PrepTask,
  type RecipeSummary,
  type Slot,
} from "./model";
import { Plate } from "./Plate";
import { useAddDish, useCompletePrepTask, useRemoveDish, useShortfall } from "./queries";
import { showStaleListToast, type SwapTarget } from "./SwapSheet";
import { mealNow, todayBrief, type CoreMeal } from "./today";
import styles from "./WeekBody.module.css";

const MAX_SHOP_NAMES = 6;
const CORE: readonly CoreMeal[] = ["breakfast", "lunch", "dinner"];
const ORDER: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const TONE: Record<MealType, "peach" | "pistachio" | "blue" | "gum" | "butter"> = {
  breakfast: "peach",
  lunch: "pistachio",
  dinner: "blue",
  snack: "gum",
  dessert: "butter",
};

interface Ctx {
  plan: PlanView;
  today: string;
  now: Date;
  isCurrentWeek: boolean;
  recipes: ReadonlyMap<string, RecipeSummary> | undefined;
  onSwap: (target: SwapTarget) => void;
  removeDish: (slot: Slot) => void;
  removing: boolean;
}

const dishTitle = (s: Slot) => s.cookEvent?.recipeTitle ?? s.label ?? (s.kind === "skip" ? "No meal planned" : "Something simple");

/** "Leftovers from Wednesday". Never "reheat": some leftovers are cold. */
const leftoverText = (slot: Slot) => (slot.cookEvent ? `Leftovers from ${weekdayName(slot.cookEvent.cookDate)}` : "Leftovers");

const photoOf = (ctx: Pick<Ctx, "recipes">, slot: Slot) => (slot.cookEvent ? ctx.recipes?.get(slot.cookEvent.recipeId)?.imageUrl : null);

const cookLink = (ctx: Pick<Ctx, "recipes">, slot: Slot) => {
  const cook = slot.cookEvent;
  return cook
    ? { to: "/recipes/$slug" as const, params: { slug: recipeSlug(ctx.recipes, cook.recipeId) }, search: cook.status === "planned" ? { cookEvent: cook.id } : {} }
    : null;
};

/* ---------- one dish's icon buttons ---------- */

function DishTools({ slot, ctx, canRemove, canAdd, isSide }: { slot: Slot; ctx: Ctx; canRemove: boolean; canAdd: boolean; isSide: boolean }) {
  const { plan, onSwap } = ctx;
  const { mealType, date, cookEvent: cook } = slot;
  const title = dishTitle(slot);
  const undo = useUndoCook();
  const { canSwap } = swapPlanFor(slot, plan);
  return (
    <>
      {slotState(slot) === "done" && cook && (
        <IconButton
          variant="plain"
          className={styles.tool}
          label={`Undo ${slotName(slot)} cooked`}
          icon={<Icon name="undo" />}
          disabled={undo.isPending}
          onClick={() => undo.mutate(cook.id, { onSuccess: () => toast.show({ message: "Cook undone. Pantry restored." }) })}
        />
      )}
      {/* A dish without a cook already opens the swap sheet from its title. */}
      {canSwap && cook && (
        <IconButton
          variant="plain"
          className={styles.tool}
          label={`Swap ${isSide ? title : slotName(slot)}`}
          icon={<Icon name="swap" />}
          onClick={() => onSwap({ date, mealType, slot })}
        />
      )}
      {canAdd && (
        <IconButton
          variant="plain"
          className={styles.tool}
          label={`Add a dish to ${slotName(slot)}`}
          icon={<Icon name="plus" />}
          onClick={() => onSwap({ date, mealType, slot: null, add: true })}
        />
      )}
      {canRemove && (
        <IconButton
          variant="plain"
          className={styles.tool}
          label={`Remove ${title} from ${slotName(slot)}`}
          icon={<Icon name="trash" />}
          disabled={ctx.removing}
          onClick={() => ctx.removeDish(slot)}
        />
      )}
    </>
  );
}

/* ---------- a meal tile: photo with a caption strip ---------- */

function Tile({ slot, ctx, side, canRemove, canAdd, isNow }: { slot: Slot; ctx: Ctx; side: boolean; canRemove: boolean; canAdd: boolean; isNow: boolean }) {
  const { plan, onSwap } = ctx;
  const title = dishTitle(slot);
  const state = slotState(slot);
  const link = cookLink(ctx, slot);
  const body = (
    <>
      <Plate imageUrl={photoOf(ctx, slot)} emoji={MEAL_EMOJI[slot.mealType]} className={styles.tilePlate} />
      <span className={styles.cap}>
        {slot.isLeftover ? (
          <span className={styles.tag}>
            <Icon name="leftover" size={14} />
            {leftoverText(slot)}
          </span>
        ) : state === "done" ? (
          <span className={styles.tag}>
            <Icon name="check" size={14} />
            Cooked
          </span>
        ) : state === "skipped" ? (
          <span className={styles.tag}>Skipped</span>
        ) : null}
        <span className={styles.tileTitle}>{title}</span>
      </span>
    </>
  );
  return (
    <li className={styles.tileCard} data-state={state} data-left={slot.isLeftover || undefined} data-side={side || undefined} data-now={isNow || undefined}>
      {link ? (
        <Link {...link} className={styles.tile} title={title}>
          {body}
        </Link>
      ) : (
        <button type="button" className={styles.tile} title={title} onClick={() => onSwap({ date: slot.date, mealType: slot.mealType, slot })}>
          {body}
        </button>
      )}
      <div className={styles.tools}>
        <DishTools slot={slot} ctx={ctx} canRemove={canRemove} canAdd={canAdd} isSide={side} />
      </div>
    </li>
  );
}

function Meal({ mealType, slots, date, ctx, isNow }: { mealType: MealType; slots: Slot[]; date: string; ctx: Ctx; isNow: boolean }) {
  return (
    <div role="group" aria-label={`${weekdayName(date)} ${mealType}`} className={styles.meal} data-meal={mealType}>
      <p className={styles.mealHead}>
        {MEAL_LABEL[mealType]}
        {isNow && (
          <span className={styles.nowTag}>
            <Icon name="flame" size={13} />
            Now
          </span>
        )}
      </p>
      {slots.length === 0 ? (
        <button
          type="button"
          className={styles.plan}
          aria-label={`Plan something for ${weekdayName(date, "short")} ${mealType}`}
          onClick={() => ctx.onSwap({ date, mealType, slot: null })}
        >
          <Icon name="plus" size={18} />
          Plan something
        </button>
      ) : (
        <ul className={styles.dishes}>
          {slots.map((slot, i) => (
            <Tile
              key={slot.id}
              slot={slot}
              ctx={ctx}
              side={i > 0}
              canRemove={slots.length > 1 && canRemoveDish(slot)}
              canAdd={i === slots.length - 1 && canAddDish(slots)}
              isNow={isNow && i === 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The meals of a day: breakfast, lunch, dinner, then snack and dessert together when planned. */
function Cells({ groups, date, ctx }: { groups: { mealType: MealType; slots: Slot[] }[]; date: string; ctx: Ctx }) {
  const nowMeal = ctx.isCurrentWeek && date === ctx.today ? mealNow(ctx.now) : null;
  const meal = (g: { mealType: MealType; slots: Slot[] }) => <Meal key={g.mealType} mealType={g.mealType} slots={g.slots} date={date} ctx={ctx} isNow={nowMeal === g.mealType} />;
  const extras = groups.filter((g) => !CORE.includes(g.mealType as CoreMeal));
  return (
    <div className={styles.cells}>
      {groups.filter((g) => CORE.includes(g.mealType as CoreMeal)).map(meal)}
      {extras.length > 0 && <div className={styles.extra}>{extras.map(meal)}</div>}
    </div>
  );
}

/* ---------- prep ---------- */

function PrepRow({ task, today }: { task: PrepTask; today: string }) {
  const complete = useCompletePrepTask();
  if (task.done) {
    return (
      <li className={cx(styles.prep, styles.prepDone)}>
        <span className={styles.prepBox} aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
        <span className={styles.prepText}>
          <span className={styles.prepWhen}>
            <Icon name="check" size={15} />
            Prep done
          </span>
          <span className={styles.prepTask}>{task.description}</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className={styles.prep} disabled={complete.isPending} aria-busy={complete.isPending || undefined} onClick={() => complete.mutate(task.id)}>
        <span className={styles.prepBox} aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
        <span className={styles.prepText}>
          <span className={styles.prepWhen}>
            <span className={styles.sr}>Mark done: </span>
            <Icon name="timer" size={15} />
            Prep · {prepDueLabel(task, today)}
          </span>
          <span className={styles.prepTask}>{task.description}</span>
        </span>
      </button>
    </li>
  );
}

/* ---------- meal chips, hero, to make today ---------- */

function TodaySection({ ctx, day, prep }: { ctx: Ctx; day: PlanDay; prep: WeekBodyProps["prep"] }) {
  const { plan, today, now } = ctx;
  const [picked, setPicked] = useState<CoreMeal | null>(null);
  const current = mealNow(now);
  const meal = picked ?? current;
  const brief = todayBrief(plan, today, now, prep ?? []);
  const donePrep = (prep ?? []).filter((t) => t.done && t.dueDate === today);
  const nothing = brief.cooks.length === 0 && brief.prep.length === 0 && donePrep.length === 0;
  const tag = meal === current ? "Now" : ORDER.indexOf(meal) > ORDER.indexOf(current) ? "Later" : "Earlier";

  return (
    <section className={styles.today} aria-label="Today">
      <div className={styles.chips} role="group" aria-label="Meal to show">
        {CORE.map((m) => (
          <button key={m} type="button" className={styles.mealChip} aria-pressed={meal === m} onClick={() => setPicked(m)}>
            <Sticker emoji={MEAL_EMOJI[m]} tone={TONE[m]} size={26} />
            {MEAL_LABEL[m]}
            {m === current && <span className={styles.chipNow}>now</span>}
          </button>
        ))}
      </div>

      <Hero key={meal} ctx={ctx} day={day} meal={meal} tag={`${tag}: ${MEAL_LABEL[meal]}`} />

      <div className={styles.todo}>
        <h2 className={styles.h}>To make today</h2>
        {nothing ? (
          <p className={styles.quiet}>Nothing to cook or prep today. Enjoy the day off.</p>
        ) : (
          <ul className={styles.list}>
            {[...brief.prep, ...donePrep].map((t) => (
              <PrepRow key={t.id} task={t} today={today} />
            ))}
            {brief.cooks.map(({ slot, meal: m, title, state }) => {
              const link = cookLink(ctx, slot);
              const done = state === "done";
              const row = (
                <>
                  <span className={styles.marker}>
                    <Icon name={done ? "check" : "flame"} size={15} />
                    {done ? "Cooked" : state === "skipped" ? "Skipped" : "Cook"}
                  </span>
                  <span className={styles.itemBody}>
                    <span className={styles.itemMeal}>{MEAL_LABEL[m]}</span>
                    <span className={styles.itemTitle}>{title}</span>
                  </span>
                  <Plate imageUrl={photoOf(ctx, slot)} emoji={MEAL_EMOJI[m]} className={styles.thumb} />
                </>
              );
              return (
                <li key={slot.id} className={cx(styles.item, done && styles.itemDone)}>
                  {link ? (
                    <Link {...link} className={styles.itemLink} title={title}>
                      {row}
                    </Link>
                  ) : (
                    <div className={styles.itemLink}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {brief.reheats.length > 0 && (
          <p className={styles.left}>
            <Icon name="leftover" size={16} />
            <span>
              <strong>Leftovers today:</strong> {brief.reheats.map((r) => `${MEAL_LABEL[r.meal]} ${r.title}`).join(", ")}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function Hero({ ctx, day, meal, tag }: { ctx: Ctx; day: PlanDay; meal: CoreMeal; tag: string }) {
  const { plan, recipes, onSwap } = ctx;
  const undo = useUndoCook();
  const slots = day.meals[meal];
  const main = slots.find((s) => s.kind === "meal") ?? slots[0];
  const sides = main ? slots.filter((s) => s !== main) : [];
  const cook = main?.cookEvent;
  const target: SwapTarget = { date: day.date, mealType: meal, slot: main ?? null };

  if (!main) {
    return (
      <div className={styles.heroWrap}>
        <div className={cx(styles.hero, styles.heroPlain)}>
          <Plate imageUrl={null} emoji={MEAL_EMOJI[meal]} className={styles.heroPlate} />
          <div className={styles.heroBody}>
            <p className={styles.kicker}>{tag}</p>
            <h2 className={styles.heroTitle}>Nothing planned for {MEAL_LABEL[meal].toLowerCase()}</h2>
            <div className={styles.actions}>
              <Button variant="primary" icon={<Icon name="plus" />} onClick={() => onSwap(target)}>
                Plan something
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const recipe = cook ? recipes?.get(cook.recipeId) : undefined;
  const link = cookLink(ctx, main);
  const state = slotState(main);
  const planned = cook?.status === "planned";
  const servings = cook ? plan.cookEvents.find((c) => c.id === cook.id)?.plannedServings : undefined;
  const { canSwap } = swapPlanFor(main, plan);
  const note = slotNote(main, plan);
  const title = dishTitle(main);

  return (
    <div className={styles.heroWrap}>
      <div className={styles.hero}>
        <Plate imageUrl={recipe?.imageUrl} emoji={MEAL_EMOJI[meal]} className={styles.heroPlate} />
        <div className={styles.heroBody}>
          <p className={styles.kicker}>{tag}</p>
          <h2 className={styles.heroTitle}>
            {link ? (
              <Link {...link} className={styles.heroLink}>
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {sides.length > 0 && <p className={styles.sub}>with {dishTitles(sides)}</p>}
          <p className={styles.meta}>
            {main.isLeftover ? (
              <Pill tone="peach" icon={<Icon name="leftover" />}>
                {leftoverText(main)}
              </Pill>
            ) : (
              <>
                {recipe?.totalMinutes != null && (
                  <span className={styles.metaItem}>
                    <Icon name="clock" size={16} />
                    {recipe.totalMinutes} min
                  </span>
                )}
                {servings !== undefined && (
                  <span className={styles.metaItem}>
                    <Icon name="people" size={16} />
                    Cooks {servings}
                  </span>
                )}
                {note && (
                  <span className={styles.metaItem}>
                    <Icon name="leftover" size={16} />
                    {note}
                  </span>
                )}
              </>
            )}
            {state === "done" && (
              <Pill tone="pistachio" icon={<Icon name="check" />}>
                Cooked
              </Pill>
            )}
            {state === "skipped" && <Pill>Skipped</Pill>}
          </p>
          <div className={styles.actions}>
            {cook && planned && !main.isLeftover && (
              <Link
                to="/recipes/$slug/cook"
                params={{ slug: recipeSlug(recipes, cook.recipeId) }}
                search={{ cookEvent: cook.id, ...(servings !== undefined ? { servings } : {}), from: "week" }}
                className={buttonClass({ variant: "primary" })}
              >
                <Icon name="flame" />
                Start cooking
              </Link>
            )}
            {link && (
              <Link {...link} className={buttonClass({ variant: "secondary" })}>
                Open recipe
              </Link>
            )}
            {canSwap && (
              <Button variant="ghost" icon={<Icon name="swap" />} onClick={() => onSwap(target)}>
                {cook ? "Swap" : "Pick a recipe"}
              </Button>
            )}
            {canAddDish(slots) && (
              <Button variant="ghost" icon={<Icon name="plus" />} aria-label={`Add dish to ${slotName(main)}`} onClick={() => onSwap({ date: day.date, mealType: meal, slot: null, add: true })}>
                Add dish
              </Button>
            )}
            {slots.length > 1 && canRemoveDish(main) && (
              <Button variant="ghost" icon={<Icon name="trash" />} aria-label={`Remove ${title} from ${slotName(main)}`} disabled={ctx.removing} onClick={() => ctx.removeDish(main)}>
                Remove
              </Button>
            )}
            {state === "done" && cook && (
              <Button
                variant="ghost"
                icon={<Icon name="undo" />}
                loading={undo.isPending}
                onClick={() => undo.mutate(cook.id, { onSuccess: () => toast.show({ message: "Cook undone. Pantry restored." }) })}
              >
                Undo
              </Button>
            )}
          </div>
          {sides.length > 0 && (
            <ul className={styles.sides} aria-label="Other dishes">
              {sides.map((s) => {
                const l = cookLink(ctx, s);
                const t = dishTitle(s);
                return (
                  <li key={s.id} className={styles.side}>
                    <Plate imageUrl={photoOf(ctx, s)} emoji={MEAL_EMOJI[meal]} className={styles.thumb} />
                    <span className={styles.sideText}>
                      {l ? (
                        <Link {...l} className={styles.sideTitle} title={t}>
                          {t}
                        </Link>
                      ) : (
                        <button type="button" className={styles.sideTitle} onClick={() => onSwap({ date: s.date, mealType: s.mealType, slot: s })}>
                          {t}
                        </button>
                      )}
                      {s.isLeftover && (
                        <span className={styles.tag}>
                          <Icon name="leftover" size={14} />
                          {leftoverText(s)}
                        </span>
                      )}
                    </span>
                    <span className={styles.sideTools}>
                      <DishTools slot={s} ctx={ctx} canRemove={canRemoveDish(s)} canAdd={false} isSide />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- shopping ---------- */

function Shop({ ctx }: { ctx: Ctx }) {
  const { plan, today, isCurrentWeek } = ctx;
  const shortfall = useShortfall(plan.id);
  const lastDay = plan.days.at(-1)?.date ?? plan.weekStart;
  if (lastDay < today || shortfall.data === undefined) return null; // nothing to shop for in a week that is over
  const lines: readonly AvailabilityLine[] = shortfall.data;
  if (lines.length === 0) {
    return (
      <p className={styles.covered}>
        <Icon name="check" size={16} /> Pantry covers the week
      </p>
    );
  }
  const names = [...new Set(lines.map((l) => l.ingredientName))];
  const shown = names.slice(0, MAX_SHOP_NAMES);
  const firstDay = plan.days[0]?.date ?? plan.weekStart;
  // The first day a planned cook runs short: shopping reads right before it.
  const needed = lines.flatMap((l) => l.committedBy.filter((u) => !u.optional).map((u) => u.cookDate)).sort()[0] ?? firstDay;
  const floor = isCurrentWeek ? today : firstDay;
  const shopDay = needed < floor ? floor : needed;
  const when = isCurrentWeek && shopDay <= today ? "today" : isCurrentWeek && shopDay === addDays(today, 1) ? "before tomorrow" : `before ${weekdayName(shopDay)}`;
  return (
    <section className={styles.shop} aria-label="Shopping">
      <span className={styles.shopIcon} aria-hidden="true">
        <Icon name="shop" size={22} />
      </span>
      <div className={styles.shopText}>
        <h2 className={styles.shopTitle}>
          Pick up {names.length} {names.length === 1 ? "thing" : "things"} {when}
        </h2>
        <p className={styles.shopNames}>
          {shown.join(", ")}
          {names.length > shown.length && ` and ${names.length - shown.length} more`}
        </p>
      </div>
      <Link to="/shop" className={buttonClass()}>
        <Icon name="shop" />
        Open shopping list
      </Link>
    </section>
  );
}

/* ---------- side rail: tomorrow and missions ---------- */

function TomorrowCard({ day, ctx }: { day: PlanDay; ctx: Ctx }) {
  return (
    <section className={cx(styles.card, styles.tomorrow)} aria-labelledby="mix-tomorrow">
      <h2 id="mix-tomorrow" className={styles.cardTitle}>
        Tomorrow <span className={styles.date}>{weekdayName(day.date, "short")} {monthDay(day.date)}</span>
      </h2>
      <ul className={styles.tmList}>
        {mealGroups(day).map(({ mealType, slots }) =>
          slots.length === 0 ? (
            <li key={mealType} className={styles.tmRow}>
              <Sticker emoji={MEAL_EMOJI[mealType]} tone={TONE[mealType]} size={44} />
              <span className={styles.tmText}>
                <span className={styles.tmMeal}>{MEAL_LABEL[mealType]}</span>
                <button type="button" className={styles.tmPlan} aria-label={`Plan something for tomorrow's ${mealType}`} onClick={() => ctx.onSwap({ date: day.date, mealType, slot: null })}>
                  <Icon name="plus" size={16} /> Plan something
                </button>
              </span>
            </li>
          ) : (
            slots.map((slot, i) => {
              const link = cookLink(ctx, slot);
              const title = dishTitle(slot);
              const inner = (
                <>
                  {photoOf(ctx, slot) ? (
                    <Plate imageUrl={photoOf(ctx, slot)} emoji={MEAL_EMOJI[mealType]} className={styles.thumbLg} />
                  ) : (
                    <Sticker emoji={MEAL_EMOJI[mealType]} tone={TONE[mealType]} size={44} />
                  )}
                  <span className={styles.tmText}>
                    <span className={styles.tmMeal}>{i === 0 ? MEAL_LABEL[mealType] : "With"}</span>
                    <span className={styles.tmTitle}>{title}</span>
                    {slot.isLeftover && (
                      <span className={styles.tag}>
                        <Icon name="leftover" size={14} />
                        {leftoverText(slot)}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={slot.id}>
                  {link ? (
                    <Link {...link} className={styles.tmRow} title={title}>
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" className={styles.tmRow} title={title} onClick={() => ctx.onSwap({ date: slot.date, mealType, slot })}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })
          ),
        )}
      </ul>
    </section>
  );
}

function MissionsCard({ plan, today, history }: { plan: PlanView; today: string; history: NonNullable<WeekBodyProps["history"]> }) {
  const missions = weekMissions(plan, history, today, readSweepCount(plan.weekStart));
  const treat = useTreat(plan.weekStart, missions.find((m) => m.id === "dinners")?.done ?? false);
  if (missions.length === 0) return null;
  const done = missions.filter((m) => m.done).length;
  return (
    <section className={cx(styles.card, styles.missions)} aria-labelledby="mix-missions">
      <header className={styles.missionsHead}>
        <Pal mood={treat.earned && !treat.spent ? "cheer" : "happy"} size={46} className={styles.pal} />
        <div>
          <h2 id="mix-missions" className={styles.cardTitle}>
            This week's missions
          </h2>
          <p className={styles.date}>
            {done} of {missions.length} done
          </p>
        </div>
      </header>
      <ul className={styles.missionList}>
        {missions.map((m) => (
          <li key={m.id} className={styles.mission} data-done={m.done || undefined}>
            <span className={styles.missionCheck} aria-hidden="true">
              {m.done && <Icon name="check" size={14} />}
            </span>
            <span className={styles.missionCopy}>
              <span className={styles.missionTitle}>{m.title}</span>
              <span className={styles.missionProgress}>
                {m.progress} of {m.target}
                {m.done && <span className={styles.sr}> (done)</span>}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <span style={{ inlineSize: `${Math.min(100, (m.progress / Math.max(1, m.target)) * 100)}%` }} />
              </span>
              {m.hint && <span className={styles.missionHint}>{m.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.treat} data-state={treat.spent ? "used" : treat.earned ? "earned" : "locked"}>
        {treat.spent ? (
          <span className={styles.treatTitle}>Treat night enjoyed</span>
        ) : treat.earned ? (
          <>
            <span className={styles.treatTitle}>Treat Stamp earned!</span>
            <button type="button" className={styles.treatButton} onClick={treat.spend}>
              Use my treat
            </button>
          </>
        ) : (
          <span className={styles.treatLocked}>Cook your dinners to earn a treat</span>
        )}
      </div>
    </section>
  );
}

/* ---------- the week ---------- */

function DayHead({ title, dateText, level: H = "h3" }: { title: string; dateText: string; level?: "h2" | "h3" }) {
  return (
    <H className={styles.dayHead}>
      {title}
      <span className={styles.date}>{dateText}</span>
    </H>
  );
}


/* ----- timeline ----- */

type Marker = "now" | "dot" | "soon";

function Node({ marker, i, current, children }: { marker: Marker; i: number; current?: boolean; children: ReactNode }) {
  return (
    <li className={styles.node} style={{ "--i": i } as CSSProperties} aria-current={current ? "date" : undefined}>
      <span className={styles.railMarker} data-kind={marker} aria-hidden="true">
        {marker === "now" && <Icon name="flame" size={15} />}
      </span>
      <div className={styles.nodeBody}>{children}</div>
    </li>
  );
}

function TimelineDay({ day, title, level, past, ctx }: { day: PlanDay; title: string; level: "h2" | "h3"; past: boolean; ctx: Ctx }) {
  const prep = past ? [] : ctx.plan.prepTasks.filter((t) => !t.done && t.dueDate === day.date);
  return (
    <>
      <DayHead title={title} dateText={`${weekdayName(day.date, "short")} ${monthDay(day.date)}`} level={level} />
      {prep.length > 0 && (
        <ul className={styles.prepList}>
          {prep.map((t) => (
            <PrepRow key={t.id} task={t} today={ctx.today} />
          ))}
        </ul>
      )}
      <Cells groups={mealGroups(day)} date={day.date} ctx={ctx} />
    </>
  );
}

function WeekTimeline({ ctx }: { ctx: Ctx }) {
  const { plan, today, now, isCurrentWeek } = ctx;
  const nodes: ReactNode[] = [];
  let earlier: ReactNode = null;
  const push = (make: (i: number) => ReactNode) => nodes.push(make(nodes.length));
  const todayDay = isCurrentWeek ? plan.days.find((d) => d.date === today) : undefined;

  if (todayDay) {
    const tomorrow = addDays(today, 1);
    const current = mealNow(now);
    const at = ORDER.indexOf(current);
    const groups = mealGroups(todayDay);
    const nowGroups = groups.filter((g) => g.mealType === current);
    const later = groups.filter((g) => ORDER.indexOf(g.mealType) > at);
    const soFar = groups.filter((g) => ORDER.indexOf(g.mealType) < at && g.slots.length > 0);
    const pastDays = plan.days.filter((d) => d.date < today);
    const tomorrowDay = plan.days.find((d) => d.date === tomorrow);
    const rest = plan.days.filter((d) => d.date > tomorrow);

    push((i) => (
      <Node key="now" marker="now" i={i} current>
        <h3 className={styles.label}>Now</h3>
        <Cells groups={nowGroups} date={today} ctx={ctx} />
      </Node>
    ));
    if (later.length > 0) {
      push((i) => (
        <Node key="later" marker="dot" i={i}>
          <h3 className={styles.label}>Later today</h3>
          <Cells groups={later} date={today} ctx={ctx} />
        </Node>
      ));
    }
    if (tomorrowDay) {
      push((i) => (
        <Node key="tomorrow" marker="soon" i={i}>
          <TimelineDay day={tomorrowDay} title="Tomorrow" level="h3" past={false} ctx={ctx} />
        </Node>
      ));
    }
    if (rest.length > 0) {
      push((i) => (
        <Node key="rest" marker="dot" i={i}>
          <h3 className={styles.label}>Rest of the week</h3>
        </Node>
      ));
      for (const day of rest) {
        push((i) => (
          <Node key={day.date} marker="dot" i={i}>
            <TimelineDay day={day} title={weekdayName(day.date)} level="h3" past={false} ctx={ctx} />
          </Node>
        ));
      }
    }
    if (pastDays.length > 0 || soFar.length > 0) {
      earlier = (
        <details className={styles.earlier}>
          <summary className={styles.earlierSummary}>
            <Icon name="caret" size={18} className={styles.chevron} />
            {pastDays.length > 0 ? "Earlier this week" : "Earlier today"}
            <Pill>{pastDays.length > 0 ? `${pastDays.length} ${pastDays.length === 1 ? "day" : "days"}` : `${soFar.length} ${soFar.length === 1 ? "meal" : "meals"}`}</Pill>
          </summary>
          {soFar.length > 0 && (
            <div className={styles.earlierDay}>
              <DayHead title="Today so far" dateText={monthDay(today)} />
              <Cells groups={soFar} date={today} ctx={ctx} />
            </div>
          )}
          {[...pastDays].reverse().map((day) => (
            <div key={day.date} className={styles.earlierDay}>
              <TimelineDay day={day} title={weekdayName(day.date)} level="h3" past ctx={ctx} />
            </div>
          ))}
        </details>
      );
    }
  } else {
    for (const day of plan.days) {
      push((i) => (
        <Node key={day.date} marker="dot" i={i}>
          <TimelineDay day={day} title={weekdayName(day.date)} level="h3" past={day.date < today} ctx={ctx} />
        </Node>
      ));
    }
  }
  return (
    <>
      <ol className={styles.rail}>{nodes}</ol>
      {earlier}
    </>
  );
}

/* ---------- the page ---------- */

export interface WeekBodyProps {
  plan: PlanView;
  /** Local date, YYYY-MM-DD. */
  today: string;
  /** Current time; drives the featured meal. */
  now: Date;
  /** False when browsing another week: no "today" content, just the plan. */
  isCurrentWeek: boolean;
  recipes: ReadonlyMap<string, RecipeSummary> | undefined;
  /** Open and done prep tasks around today. */
  prep: readonly PrepTask[] | undefined;
  /** Done cooks, oldest first (for missions). */
  history: readonly { recipeId: string; recipeTitle: string; cookDate: string }[] | undefined;
  onSwap: (target: SwapTarget) => void;
}

/** The week page under the header: today's meals, shopping, side rail, then the week as a timeline. Any week. */
export function WeekBody({ plan, today, now, isCurrentWeek, recipes, prep, history, onSwap }: WeekBodyProps) {
  const remove = useRemoveDish(plan.id);
  const add = useAddDish(plan.id);
  const navigate = useNavigate();
  const ctx: Ctx = {
    plan,
    today,
    now,
    isCurrentWeek,
    recipes,
    onSwap,
    removing: remove.isPending,
    removeDish: (slot) => {
      const cook = slot.cookEvent;
      remove.mutate(slot.id, {
        onSuccess: ({ shoppingListStale }) => {
          // Undo adds the recipe back (a fresh cook); a leftover or a note has nothing to re-add.
          toast.show({
            message: `${dishTitle(slot)} removed from ${slotName(slot)}.`,
            ...(cook && !slot.isLeftover
              ? { action: { label: "Undo", onClick: () => add.mutate({ date: slot.date, mealType: slot.mealType, recipeId: cook.recipeId }) } }
              : {}),
          });
          if (shoppingListStale) showStaleListToast(() => void navigate({ to: "/shop" }));
        },
      });
    },
  };
  const todayDay = isCurrentWeek ? plan.days.find((d) => d.date === today) : undefined;
  const tomorrowDay = isCurrentWeek ? plan.days.find((d) => d.date === addDays(today, 1)) : undefined;

  return (
    <div className={styles.root}>
      <div className={styles.layout} data-solo={!isCurrentWeek || undefined}>
        <div className={styles.main}>
          {todayDay && <TodaySection ctx={ctx} day={todayDay} prep={prep} />}
          <Shop ctx={ctx} />
        </div>
        {tomorrowDay && <TomorrowCard day={tomorrowDay} ctx={ctx} />}
        {isCurrentWeek && history && <MissionsCard plan={plan} today={today} history={history} />}
        <section className={styles.week} aria-labelledby="mix-week">
          <h2 id="mix-week" className={styles.h}>
            The week
          </h2>
          <WeekTimeline ctx={ctx} />
        </section>
      </div>
    </div>
  );
}
