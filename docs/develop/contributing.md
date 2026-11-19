# Contribute

## Report a bug

[Open an issue](https://github.com/dev-arekusandoru/pantry-pal/issues) with:

- What you did.
- What you expected.
- What happened.
- The commit or version, browser, and setup method.
- Steps that let another person reproduce the problem.

Remove tokens, private recipe notes, and household data from logs and images.

## Suggest a change

Explain the task you cannot complete and why it matters. For a large change,
open an issue before you start work.

## Submit code or docs

1. Follow [Local setup](setup.md).
2. Create a branch with one clear purpose.
3. Make the change and update the affected docs.
4. Follow [Tests and checks](checks.md).
5. [Open a pull request](https://github.com/dev-arekusandoru/pantry-pal/pulls).
   State the problem, the change, and the checks you ran.

For UI changes, include screenshots. For behavior changes, include a regression
test when it can catch a real user problem.

Keep docs brief. Use common words, short sentences, and the same name for each
concept. Put procedures in guides and exact fields in reference pages.

## Add ingredient icons

Icons are 160 px WebP files in `web/src/assets/ingredients/`. Drop in a file with
a descriptive name, for example `olive-oil.webp`, and the app matches it by name.
Then run `pnpm icons:manifest` so the server accepts the name. See the README in
that folder for the sheet workflow, naming rules, and matcher overrides.

## Update nutrition data

Recipe nutrition reads `nutrition/usda-foods.json.gz`, a snapshot of USDA
FoodData Central (SR Legacy and Foundation Foods). The server never downloads
data at run time. To rebuild the file, run from the repository root:

```sh
pnpm nutrition:data
```

The script downloads the CSV archives from `fdc.nal.usda.gov`, caches them in
the system temporary directory, and writes the snapshot. Commit the new file.
To use newer archives, change the URLs in `scripts/nutrition-data.ts` and the
`NUTRITION_SOURCE` text in `src/services/foods.ts`. Run `pnpm test` afterward.
The Docker image copies the `nutrition/` directory.

Many Foundation foods list no portions. The script copies the portions of the
closest SR Legacy food: the same food in the same form (raw, cooked, canned),
found by matching the description words. It marks each copied portion as
estimated and stores the source as `portionsFrom`. A food with no confident
match keeps no portions. Hand-checked matches are in `BORROW_OVERRIDES` in the
script. Run `pnpm nutrition:data --report` to list every match and every
food left without portions.
