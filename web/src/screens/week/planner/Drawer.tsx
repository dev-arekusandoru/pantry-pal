import { useDraggable } from "@dnd-kit/core";
import { useMemo, useState, type ReactNode } from "react";
import { Emoji, Icon, SearchInput, Skeleton, type EmojiCode } from "@/ui";
import { MEAL_EMOJI, MEAL_LABEL, type MealType, type RecipeSummary } from "../model";
import styles from "./Planner.module.css";
import { recipeIcon, sameItem, type Item } from "./model";

const DAY_MS = 86_400_000;

const FILTERS: { id: string; label: string; test: (r: RecipeSummary) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "quick", label: "Quick (30 min)", test: (r) => r.totalMinutes !== null && r.totalMinutes <= 30 },
  { id: "recent", label: "Cooked lately", test: (r) => r.lastCookedAt !== null && Date.now() - Date.parse(r.lastCookedAt) < 30 * DAY_MS },
  { id: "never", label: "Never cooked", test: (r) => r.timesCooked === 0 },
  { id: "fav", label: "Favorites", test: (r) => r.status === "rotation" },
];

const FREEFORM: Extract<Item, { type: "note" }>[] = [
  { type: "note", key: "eat-out", kind: "freeform", label: "Eat out", icon: "french-fries" },
  { type: "note", key: "fridge", kind: "freeform", label: "Fridge clean-out", icon: "milk" },
];
/** Name is typed in the cell it lands in, so the card carries no text. */
const CUSTOM: Extract<Item, { type: "note" }> = { type: "note", key: "custom", kind: "freeform", label: "", icon: "clay-pot" };

type SectionId = MealType | "other" | "notes";
const MEAL_SECTIONS: readonly MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const sectionLabel = (id: SectionId) => (id === "other" ? "Other" : id === "notes" ? "Not cooking" : MEAL_LABEL[id]);
const sectionIcon = (id: SectionId): EmojiCode => (id === "other" ? "clay-pot" : id === "notes" ? "bread-loaf" : MEAL_EMOJI[id]);

/** Collapsible group with a sticky divider. A recipe that suits several meals shows up in each. */
function Section({ id, count, cue, open, onToggle, children }: { id: SectionId; count: number; cue?: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={styles.sec} data-cue={cue ? "" : undefined}>
      <h3 className={styles.secHead}>
        <button type="button" className={styles.secBtn} aria-expanded={open} onClick={onToggle}>
          <Emoji code={sectionIcon(id)} size={22} />
          <span className={styles.secName}>{sectionLabel(id)}</span>
          <span className={styles.secCount}>{count}</span>
          <Icon name="caret" size={16} className={styles.secCaret} />
        </button>
      </h3>
      {open && children}
    </section>
  );
}

function Thumb({ recipe }: { recipe: RecipeSummary }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.thumb} aria-hidden="true">
      <Emoji code={recipeIcon(recipe.title)} size={24} />
      {recipe.imageUrl && !failed && <img className={styles.thumbImg} src={recipe.imageUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />}
    </span>
  );
}

function DrawerCard({ id, item, name, thumb, meta, picked, onPick }: {
  id: string;
  item: Item;
  name: string;
  thumb: ReactNode;
  meta?: string;
  picked: boolean;
  onPick: () => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id, data: item });
  return (
    <li ref={setNodeRef} className={styles.card} data-selected={picked ? "" : undefined} data-dragging={isDragging ? "" : undefined}>
      <div ref={setActivatorNodeRef} className={styles.cardBody} title={name} {...attributes} {...listeners}>
        {thumb}
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>{name}</span>
          {meta && <span className={styles.cardMeta}>{meta}</span>}
        </span>
      </div>
      <button type="button" className={styles.pick} aria-pressed={picked} aria-label={`Place ${name}`} onClick={onPick}>
        <Icon name={picked ? "check" : "plus"} size={16} />
      </button>
    </li>
  );
}

const meta = (r: RecipeSummary) => [r.totalMinutes ? `${r.totalMinutes} min` : null, `serves ${r.servings}`].filter(Boolean).join(" · ");

export function Drawer({ recipes, selected, onSelect }: { recipes: Map<string, RecipeSummary> | undefined; selected: Item | null; onSelect: (i: Item | null) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [shut, setShut] = useState<ReadonlySet<SectionId>>(new Set());
  const toggle = (id: SectionId) =>
    setShut((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const list = useMemo(() => {
    if (!recipes) return undefined;
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    const q = query.trim().toLowerCase();
    const out = [...recipes.values()].filter((r) => r.status !== "archived" && test(r) && (!q || `${r.title} ${r.cuisine ?? ""} ${r.tags.join(" ")}`.toLowerCase().includes(q)));
    return filter === "recent"
      ? out.sort((a, b) => Date.parse(b.lastCookedAt ?? "") - Date.parse(a.lastCookedAt ?? ""))
      : out.sort((a, b) => a.title.localeCompare(b.title));
  }, [recipes, query, filter]);

  const sections = useMemo(
    () =>
      list &&
      ([...MEAL_SECTIONS, "other"] as const)
        .map((id) => ({ id, recipes: list.filter((r) => (id === "other" ? r.mealTypes.length === 0 : r.mealTypes.includes(id))) }))
        .filter((x) => x.recipes.length > 0),
    [list],
  );
  const suits = selected?.type === "recipe" ? selected.recipe.mealTypes : [];
  const pick = (item: Item) => onSelect(selected && sameItem(selected, item) ? null : item);
  const isPicked = (item: Item) => selected !== null && sameItem(selected, item);
  const noteThumb = (icon: string) => (
    <span className={styles.thumb} data-note="" aria-hidden="true">
      <Emoji code={icon} size={22} />
    </span>
  );

  return (
    <aside className={styles.drawer} aria-label="Recipe drawer">
      <div className={styles.drawerHead}>
        <h2 className={styles.drawerTitle}>Recipe drawer</h2>
        <SearchInput label="Search recipes" value={query} onChange={setQuery} />
        <div className={styles.filters} role="group" aria-label="Filter recipes">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={styles.fchip} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.drawerList}>
        {!sections && (
          <ul className={styles.cards} aria-label="Recipes" aria-busy>
            {[0, 1, 2, 3].map((i) => <li key={i} className={styles.card}><Skeleton height={44} radius={12} /></li>)}
          </ul>
        )}
        {sections?.map(({ id, recipes: rs }) => (
          <Section key={id} id={id} count={rs.length} cue={id !== "other" && suits.includes(id)} open={!shut.has(id)} onToggle={() => toggle(id)}>
            <ul className={styles.cards} aria-label={sectionLabel(id)}>
              {rs.map((r) => {
                const item: Item = { type: "recipe", recipe: r };
                return <DrawerCard key={r.id} id={`recipe:${r.id}:${id}`} item={item} name={r.title} thumb={<Thumb recipe={r} />} meta={meta(r)} picked={isPicked(item)} onPick={() => pick(item)} />;
              })}
            </ul>
          </Section>
        ))}
        {sections?.length === 0 && <p className={styles.empty}>No recipes match. Try another filter?</p>}

        <Section id="notes" count={FREEFORM.length + 1} open={!shut.has("notes")} onToggle={() => toggle("notes")}>
          <ul className={styles.cards} aria-label="Notes">
            {FREEFORM.map((n) => (
              <DrawerCard key={n.key} id={`note:${n.key}`} item={n} name={n.label} thumb={noteThumb(n.icon)} picked={isPicked(n)} onPick={() => pick(n)} />
            ))}
            <DrawerCard id="note:custom" item={CUSTOM} name="Write your own" meta="Name it where you place it" thumb={noteThumb(CUSTOM.icon)} picked={isPicked(CUSTOM)} onPick={() => pick(CUSTOM)} />
          </ul>
        </Section>
      </div>
    </aside>
  );
}
