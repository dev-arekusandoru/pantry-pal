import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type FormEvent } from "react";
import { client, errorMessage, qk, unwrap } from "@/api";
import { Button } from "./Button";
import styles from "./IconPicker.module.css";
import { Emoji } from "./Emoji";
import { EMOJI_ASSETS } from "./foodIcons";
import { ingredientEmoji } from "./ingredientEmoji";
import { SearchInput } from "./SearchInput";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

/** Sorted once; 477 icons make an inline sort in render noticeable. */
const ICON_NAMES = Object.keys(EMOJI_ASSETS).sort();

const humanised = ICON_NAMES.map((name) => ({ name, label: name.replaceAll("-", " ") }));

export interface IconPickerProps {
  /** Null closes the sheet. */
  ingredient: { id: string; name: string; imageUrl: string | null } | null;
  onClose: () => void;
}

/**
 * Choose an ingredient icon: the automatic pick, a bundled icon, or a custom
 * https image. Saving patches the ingredient and refreshes every view that
 * shows it.
 */
export function IconPicker({ ingredient, onClose }: IconPickerProps) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const urlId = useId();
  const save = useMutation({
    mutationFn: (imageUrl: string | null) =>
      unwrap(
        client.PATCH("/ingredients/{id}", {
          params: { path: { id: ingredient?.id ?? "" } },
          body: { imageUrl },
        }),
      ),
    onSuccess: () =>
      Promise.all(
        [qk.ingredients, qk.pantry, qk.shoppingLists, qk.recipes].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      ),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? humanised : humanised.filter((icon) => icon.label.includes(needle));
  }, [query]);

  if (!ingredient) return null;
  const automatic = ingredientEmoji(ingredient.name);
  const chosenUrl = /^https:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;

  function pick(imageUrl: string | null) {
    save.mutate(imageUrl, {
      onSuccess: () => {
        setQuery("");
        setUrl("");
        onClose();
      },
    });
  }

  function submitUrl(e: FormEvent) {
    e.preventDefault();
    if (chosenUrl !== null) pick(chosenUrl);
  }

  return (
    <Sheet open title={`Icon for ${ingredient.name}`} onClose={onClose}>
      <div className={styles.picker}>
        <SearchInput label="Search icons" value={query} onChange={setQuery} />

        <button
          type="button"
          className={styles.automatic}
          aria-pressed={ingredient.imageUrl === null}
          disabled={save.isPending}
          onClick={() => pick(null)}
        >
          <span className={styles.autoIcon} aria-hidden="true">
            <Emoji code={automatic} size={30} />
          </span>
          <span className={styles.autoText}>
            <b>Automatic</b>
            <small>{automatic.replaceAll("-", " ")}</small>
          </span>
        </button>

        <ul className={styles.grid}>
          {filtered.map((icon) => (
            <li key={icon.name}>
              <button
                type="button"
                className={styles.choice}
                aria-label={icon.label}
                aria-pressed={ingredient.imageUrl === icon.name}
                disabled={save.isPending}
                onClick={() => pick(icon.name)}
              >
                <Emoji code={icon.name} size={36} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && <p className={styles.empty}>No icons match "{query.trim()}".</p>}

        <form className={styles.urlForm} onSubmit={submitUrl}>
          <label className={styles.urlLabel} htmlFor={urlId}>
            Custom image URL
          </label>
          <div className={styles.urlRow}>
            <input
              id={urlId}
              type="url"
              className={styles.urlInput}
              inputMode="url"
              autoComplete="off"
              placeholder="https://example.com/icon.png"
              value={url}
              aria-invalid={url.trim() !== "" && chosenUrl === null ? true : undefined}
              aria-describedby={`${urlId}-hint`}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button type="submit" variant="primary" loading={save.isPending} disabled={chosenUrl === null}>
              Use image
            </Button>
          </div>
          <p id={`${urlId}-hint`} className={styles.urlHint}>
            Use an https image link. Leave it and pick any icon to go back to a built-in one.
          </p>
        </form>
      </div>
    </Sheet>
  );
}
