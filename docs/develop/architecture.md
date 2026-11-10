# Architecture

```mermaid
flowchart LR
  Web[Web app] --> REST[REST API]
  Agent[AI assistant] --> MCP[MCP endpoint]
  subgraph Server[Node.js server]
    REST --> Services[Service layer]
    MCP --> Services
  end
  Services --> DB[(SQLite)]
```

## Code map

| Path | Purpose |
| --- | --- |
| `web/src/` | React web app, routes, screens, and shared UI |
| `src/api/` | Hono routes, OpenAPI, and static file serving |
| `src/auth/` | Bearer tokens, browser sessions, and origin checks |
| `src/mcp/` | MCP transport and tool handlers |
| `src/services/` | Food calculations and data changes |
| `src/schemas/` | Zod input and output schemas |
| `src/db/schema.ts` | Database tables |
| `drizzle/` | Database migrations |
| `src/seed/` | JSON import loader |
| `src/cli.ts` | Household, token, migration, and import commands |

Keep food calculations in services. REST routes and MCP tools call the same
services. Clients must not duplicate stock or serving calculations.

## Web UI conventions

Use the shared components in `web/src/ui/`. Do not write a second copy of one.
`SegmentedControl` is the only chip row. `ConfirmDialog` is the only destructive
confirmation. `Button` has these variants:

| Variant | Use |
| --- | --- |
| `primary` | The one affirmative action of a screen. |
| `secondary` | A normal action. |
| `ghost` | A low-weight action. |
| `danger` | The confirm inside `ConfirmDialog`. |
| `dangerGhost` | A trigger for a destructive action. |

- Destructive actions: confirm with `ConfirmDialog`, whose confirm button is
  `danger`. Never use `primary` for a delete, remove, clear, or a permanent
  status change. Mark the matching chip with `danger: true` in
  `SegmentedControl`.
- Sheets: `Sheet` is a bottom sheet on phones and a centered 560 px dialog from
  700 px. The `footer` holds the secondary action first and the primary last.
  Keep destructive actions out of the footer.
- Add actions: one entry point per state. An empty screen carries the primary in
  `EmptyState`. A filled screen carries one add button in the header or in a
  toolbar row above the list. Do not stack a `Fab` with another add action.
- Toolbars: navigation and list controls (week pagination, list switcher) get
  their own row below `PageHeader`. Do not put them in the header `sub`; they
  are clipped at 320 px there.
- Action rows: one primary and one secondary at most. Move further actions into
  an icon button or a menu.

## Data rules

- Each instance supports one household. Household data carries a household ID.
- Stock movements record changes. Pantry rows hold the current stock.
- Planned cooks determine stock commitments. There is no separate reservation table.
- One cook can feed several meal slots. Later slots represent leftovers.
- A recipe keeps separate ingredient and step records.
- Quantities can be unknown. Do not treat an unknown amount as zero.
- Use defined unit conversions. Do not guess a weight from a volume.

## Schema changes

1. Change `src/db/schema.ts`.
2. Run `pnpm db:generate`.
3. Review and include the generated migration files.
4. Check the migration against a copy of an existing database.

The server and CLI apply pending migrations when they open the database.
A code rollback does not undo a migration. See [Updates](../host/updates.md).
