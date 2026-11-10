# Pantry

The Pantry tab shows what you have at home. Each row is one ingredient. Rows are
grouped by ingredient category, in the same order as the shopping list, and
sorted by name.

![Pantry screen with category groups, search, and quantity controls](../images/pantry.png)

## Find stock

Use **Search the pantry** to filter by name. The chips under the search box
filter by category. **Everything** shows all categories; the other chips appear
only when that category has stock.

## Add stock

Tap the **+** button. If the pantry is empty, tap **Add**. Then fill in:

- **What is it?**
- **How much? (optional)**
- **Unit**
- **Shopping aisle**

The aisle is the ingredient category. It groups pantry rows and shopping items.
It is used when the app creates an ingredient.

With an amount, the app adds to the stock already recorded for that ingredient. A
new name creates a new ingredient. Without an amount, the app records the item as
**On hand** and leaves the quantity unknown.

## Change an amount

A measured row has **−** and **+** buttons. One tap changes the amount by:

| Unit | Step |
| --- | --- |
| `lb`, `kg`, `l`, `cup`, `gallon` | 0.5 |
| `g`, `ml` | 50 |
| Any other unit, or no unit | 1 |

The amount cannot go below zero. Tap the amount or the row name to open a sheet
and type an exact amount. Tap **Save**.

The same sheet shows **Category**, **Best before**, and **Shelf life in days**.
Change any value, then tap **Save**. Change **Category** to move the ingredient to
another group. Clear **Best before** to remove the date. Clear **Shelf life in
days** to stop dating future purchases of this ingredient.

A row with an expiry date shows **Best before**. An item that expires in three
days or less gets an **Expiring soon** badge. An item past its date gets an
**Expired** badge. Tap **Add to list** on either row to add the ingredient to
this week's list, the newest open list, or a new list.

When a shopping trip completes, each received ingredient gets a purchase date of
today. If the ingredient has a shelf life, the app sets its expiry date to today
plus that number of days.

An unmeasured row shows a status pill: **On hand**, **Running low**, or
**Out**. Tap the pill to change it. **Not sure** can also appear when another
client set an unknown status; the app does not offer it.

For measured items, the server sets the status:

- Zero is **Out**.
- At or below the ingredient's par level is **Running low**.
- Anything else is **On hand**.

## Exact, approximate, and unknown amounts

| State | How it is set |
| --- | --- |
| Exact | Enter an amount in the app or send `qty` and `unit` through the API or MCP. |
| Approximate | Set `qtyApprox: true` through the API or MCP. The app has no control for this flag. |
| Unknown | Add an item without an amount, or send `qty: null`. |

An unknown amount is not zero. The recipe page does not count it as missing.
A shopping list adds a **check the pantry** note instead of assuming the item is
missing, unless the item is marked **Running low** or **Out**. In that case the
list gets the full amount the plan needs.

The app records exact amounts. It shows an approximate amount as a normal
number, without an estimate marker.

## Remove stock

Open the item's amount sheet, tap **Remove from pantry**, then confirm with
**Remove**. The toast offers **Undo**. Undo puts the row back with its amount. It
does not restore the row's past stock movements.

## Through the API or MCP

These tasks have no web screen:

- Mark stock as checked: `pantry_update` with `action: "verify"`.
- Add notes, purchase dates, or open dates.
- Read stock history: `pantry_history`.
- Set ingredient aliases, par levels, default units, or categories
  (`ingredient_upsert` with `action: "update"`). The web item sheet changes the
  category for you.

See [Common MCP tasks](../connect/tasks.md) and the
[MCP tool reference](../reference/mcp-tools.md). The REST endpoints are in the
[REST API reference](../reference/rest-api.md).
