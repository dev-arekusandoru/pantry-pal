# Ingredient icons

Each ingredient has an icon. It shows in the Pantry, the shopping list, recipes,
and cook mode.

## How the app picks an icon

The app uses the first rule that applies:

1. A custom image link that you set.
2. A bundled icon that you chose.
3. A bundled icon that matches the ingredient name or one of its aliases.
4. An empty bowl.

An empty bowl means the app has no icon for that name. In the Pantry and on the
shopping list, the bowl looks dimmed with a dashed ring.

## Choose an icon

1. Open the icon sheet. You can do this three ways:
   - In the Pantry, tap an ingredient, then tap **Change icon**.
   - On the shopping list, tap the icon in a row.
   - Tap a dimmed bowl.
2. Type in **Search icons**, then tap an icon.

Choose **Automatic** to go back to name matching. To use your own picture, enter
an `https://` link in the custom image field. If the image does not load, the app
shows the automatic icon.

A free-text shopping item has no ingredient, so it cannot have its own icon.

## Find ingredients without an icon

Open Settings. **Items without an icon** lists every ingredient that shows the
empty bowl. Tap **Choose icon** on a row to pick one. Tap **Request an icon** to
open a prefilled GitHub issue with these names. The app sends nothing until you
submit the issue.

## Through the API or MCP

The ingredient field `imageUrl` holds the choice:

| Value | Result |
| --- | --- |
| `null` or empty | Automatic icon. |
| A bundled icon name, such as `garlic` | That icon. |
| An `http://` or `https://` link | A custom image. |

Any other value fails validation. Use `PATCH /ingredients/{id}` or
`ingredient_upsert` with `action: "update"` to set it. The MCP tool `list_icons`
returns the bundled names; its `query` input filters them.

To add icons to the app, see [Contribute](../develop/contributing.md#add-ingredient-icons).
