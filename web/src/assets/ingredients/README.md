# Ingredient icons

Every `*.webp` here (160x160, transparent, lossy q92 + lossless alpha) is an
ingredient icon. `ui/foodIcons.ts` loads them all with `import.meta.glob`; the
file name without `.webp` is the icon name. `ui/ingredientEmoji.ts` picks an
icon for an ingredient by matching words in that name. Adding an icon means
dropping a WebP here. No code change.

The icons come from AI-generated sheets (4 columns x 3 rows, 12 icons, white
background) stored in `new-icons/custom-sheets/`, plus the original "400+ Free
Food Assets" pack (https://2yeet.itch.io/foodassets) in the other `new-icons/`
folders.

## Add a new sheet

1. **Generate** a sheet in ChatGPT: attach 1-2 existing sheets as style
   reference and use the prompt in `PROMPT.md` (this folder), swapping the item
   list. Keep to 12 items, wide gaps, plain white background. Save it to
   `new-icons/custom-sheets/`. Size must be 1448x1086 (362px cells); the script
   assumes that grid.
2. **Look at the sheet** and write down what each of the 12 icons really is, in
   reading order. The model often draws something other than what you asked for.
3. **Name them** (rules below), then slice:

   ```sh
   python3 web/scripts/process-icon-sheet.py "new-icons/custom-sheets/<sheet>.png" /tmp/staged/<slug> \
     apple banana ... (exactly 12 names)
   ```

   Needs only Pillow. It flood-fills the white background from each cell edge,
   fills transparent areas with the outline brown (no white halo), scales the
   icon to fit 148px centered in 160px, writes lossy WebP (q92, alpha kept),
   and writes `_preview.png` (all 12 on blue).
4. **Read `_preview.png`.** Fix problems and rerun:
   - `WARN ... touches crop edge`: the icon crosses its 362px cell, or a
     neighbour bleeds in (thin slivers at the top/bottom). Pass `--box
     N=x0,y0,x1,y1` (sheet pixels, N = 1-based icon number) to crop the whole
     icon but no neighbour.
   - White blob trapped between parts (cherry stems): `--enclosed N`. It also
     removes large pure-white areas inside the icon, so check eyes/bellies/labels
     afterwards.
5. **Merge**: copy the WebPs into this folder. Before copying, check for an icon
   with the same name, or with the same words after singularisation: the matcher
   cannot rank two names with the same words, so keep one. If both are real,
   distinct ingredients, give the new one a distinguishing ingredient word
   (`peas` vs `frozen-peas`, `lime` vs `lime-wedge`, `horseradish` vs
   `prepared-horseradish`).
6. **Check references**: `grep -rn '"<old-name>"' web/src`. Code uses icon names
   as plain strings (empty states, tabs, week plates), and `tsc` will not catch
   a deleted file. The jar logo is `relish`, the default fallback is `empty-bowl`.
7. Run `cd web && npx tsc --noEmit && npx vitest run && npx vite build`. Add a
   case to `ui/ingredientEmoji.test.ts` for icons that need an alias.

## Custom and automatic icons

An ingredient's `imageUrl` is one of three things:

- `null`: automatic. `ui/ingredientEmoji.ts` picks an icon from the name.
- a bundled icon name such as `garlic`: that icon, whatever the name suggests.
- an `http(s)://` URL: a custom image. If it fails to load, the automatic icon
  shows instead.

`ui/IconPicker.tsx` is the picker. Pantry rows (missing icons and the item
sheet), shopping list rows, and Settings > Items without an icon open it.

## Naming rules

`<ingredient>[-<variant word>]`, lowercase kebab-case.

- No category prefix (`carb`, `green`, `condiment`, ...) and no container suffix
  (`bottle jar bowl can carton tub packet glass tin pile shaker cup box tube bag`).
  Two icons of the same ingredient collapse to one name, so one of them wins.
- The name is what a recipe writes (`scallops`, `fish-sauce`). **Every word must
  appear in an ingredient name for the icon to match**, so no colors, `fresh`,
  `cartoon`.
- More words beat fewer: "coconut milk" gets `coconut-milk`, not `coconut`. On a
  tie the icon naming the ingredient's last word wins ("cherry tomatoes" is
  `tomato`).
- Non-ingredient art keeps a descriptive name: `empty-bowl` (fallback) and
  `relish` (pantry jar logo).
- Names the files cannot express (`green onions`, `black pepper`, `chicken
  thighs`) go in `ALIASES` in `ui/ingredientEmoji.ts`. Aliases are checked first.

## Known gaps

No icon: chia is covered, but there is nothing for most fruit juices, bread
varieties beyond `bread-loaf`/`bread-roll`/`baguette`, and many prepared foods.
Unknown ingredients fall back to `DEFAULT_ICON`.

## Gotcha: stale test cache

Vitest caches the expanded `import.meta.glob` in `<repo>/node_modules/.vitest-cache`.
After you add or delete icons, tests can still see the old list (new icon "does
not exist"). Run `rm -rf node_modules/.vitest-cache` at the repo root. `vite build`
and `vite dev` are not affected.
