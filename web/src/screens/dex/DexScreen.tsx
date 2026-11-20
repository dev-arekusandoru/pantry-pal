import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CATEGORY_ORDER, aisleLabel } from "@/screens/aisles";
import { buttonClass, EmptyState, Emoji, ErrorState, PageHeader, Skeleton, ingredientEmoji } from "@/ui";
import { useDex } from "./queries";
import styles from "./Dex.module.css";

export function DexScreen() {
  const dex = useDex();
  const [open, setOpen] = useState<string | null>(null);
  if (dex.error) return <><PageHeader title="Sticker book" /><ErrorState error={dex.error} onRetry={dex.refetch} /></>;
  if (!dex.data) return <div aria-busy="true" aria-label="Loading the sticker book"><PageHeader title="Sticker book" /><Skeleton height={12} /><Skeleton height={220} /></div>;
  const { entries, catalog } = dex.data;
  const collected = new Map(entries.map((entry) => [entry.id, entry]));
  const groups = CATEGORY_ORDER.map((category) => ({ category, items: catalog.filter((item) => item.category === category).sort((a, b) => a.name.localeCompare(b.name)) })).filter((group) => group.items.length);
  return <>
    <PageHeader title="Sticker book" sub={`${entries.length} of ${catalog.length} ingredients collected`} />
    <div className={styles.progress} role="progressbar" aria-label="Ingredients collected" aria-valuemin={0} aria-valuemax={catalog.length} aria-valuenow={entries.length}><span style={{ width: `${catalog.length ? entries.length / catalog.length * 100 : 0}%` }} /></div>
    {entries.length === 0 ? <EmptyState emoji="relish" title="Your sticker book is waiting" action={<Link className={buttonClass({ variant: "primary" })} to="/">Visit the week</Link>}>Cook something together and Raku will help you collect ingredient stickers.</EmptyState> : groups.map(({ category, items }) => <section className={styles.group} key={category}><h2>{aisleLabel(category)}</h2><div className={styles.grid}>{items.map((item) => {
      const entry = collected.get(item.id);
      const expanded = open === item.id;
      return <article key={item.id} className={`${styles.tile} ${!entry ? styles.uncollected : ""}`}>
        {entry ? <button aria-expanded={expanded} aria-label={`${item.name}, first cooked ${entry.firstCooked}, ${entry.times} cooks`} onClick={() => setOpen(expanded ? null : item.id)}><Emoji code={ingredientEmoji(item.name, item.imageUrl)} size={42} /><span className={styles.name}>{item.name}</span><span className={styles.meta}>First cooked {new Date(`${entry.firstCooked}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ×{entry.times}</span></button> : <div className={styles.silhouette} role="img" aria-label={`Not cooked yet: ${item.name}`}><Emoji code={ingredientEmoji(item.name, item.imageUrl)} size={42} /><span className={styles.name} aria-hidden="true">{item.name}</span></div>}
        {entry && expanded && <>
          <p className={styles.recipes}>Used in: {entry.recipes.join(", ")}</p>
          <Link className={styles.open} to="/ingredients/$id" params={{ id: item.id }}>Open {item.name}</Link>
        </>}
      </article>;
    })}</div></section>)}
  </>;
}
