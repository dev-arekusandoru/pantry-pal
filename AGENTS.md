# Agent instructions

## Keep documentation current

- Update docs in the same change as a feature, bug fix, or behavior change.
- Check the code before you describe behavior. Mark tasks that need the API or
  MCP rather than the web app. Do not describe planned features as available.
- Keep one source for each topic in `docs/`. Docusaurus builds from these files.
- Update affected guides and references when commands, settings, API inputs,
  defaults, access rules, or data formats change. Remove obsolete instructions.
- Add new pages to `site/sidebars.js` and `docs/README.md`.
- Update screenshots when the visible UI or task steps change.
- Keep the README short: purpose, screenshots, key features, and links. Put
  setup steps and detailed instructions in the docs. Its documentation link
  points to `https://dev-arekusandoru.github.io/pantry-pal/`.

## Write clearly

- Follow ASD-STE100 principles: common words, short sentences, and active voice.
- Use the same term for the same concept. Use exact UI labels and command names.
- Prefer short task steps. Use tables for options and diagrams for flows.
- Link to existing explanations instead of repeating them.

## Check the change

- Run documented commands or examples that the change affects. Use test data;
  do not change a real household or expose secrets.
- Run `pnpm docs:build` after doc or site changes. Fix broken links and anchors.
- Use `pnpm docs:dev` to check changed pages, images, and navigation in a browser.
- Do not push, deploy, or change GitHub Pages settings unless the user asks.
