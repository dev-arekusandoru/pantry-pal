import { z } from "@hono/zod-openapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../../context.js";
import { householdSettingsSchema } from "../../schemas/household.js";
import {
  createMember,
  deleteMember,
  getHousehold,
  listMembers,
  updateHousehold,
  updateMember,
} from "../../services/households.js";
import { requireArg, tool } from "./util.js";

const memberOpSchema = z.object({
  action: z.enum(["upsert", "delete"]).describe("upsert creates or updates a member; delete removes one."),
  memberId: z.string().optional().describe("Existing member id (mem_…) for update/delete."),
  name: z.string().min(1).optional().describe("Member name (required when creating)."),
  notes: z.string().nullish().describe('Dietary notes, e.g. "no mushrooms".'),
});

const householdUpdateInput = z.object({
  name: z.string().min(1).optional().describe("Household display name."),
  timezone: z.string().min(1).optional().describe("IANA timezone, e.g. Europe/Berlin."),
  settings: householdSettingsSchema
    .partial()
    .optional()
    .describe("Partial settings; provided keys are merged over the current settings."),
  members: z.array(memberOpSchema).optional().describe("Member upserts/deletes, applied in order."),
});

function householdState(ctx: Ctx) {
  return {
    household: getHousehold(ctx.db, ctx.householdId),
    members: listMembers(ctx).items,
  };
}

export function registerHouseholdTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "household_get",
    {
      title: "Household",
      description:
        "Household name, timezone, settings (default servings, spice level, batch sizes, week start, unit system, planning notes) and members.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    tool(() => householdState(ctx)),
  );

  server.registerTool(
    "household_update",
    {
      title: "Update household",
      description:
        "Update the household name, timezone or settings, and upsert/delete members. Settings are merged key-by-key; returns the household with its members.",
      inputSchema: householdUpdateInput,
      annotations: { destructiveHint: true },
    },
    tool((args: z.infer<typeof householdUpdateInput>) => {
      const hasHouseholdFields =
        args.name !== undefined || args.timezone !== undefined || args.settings !== undefined;
      if (hasHouseholdFields) {
        updateHousehold(ctx, {
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
          ...(args.settings === undefined ? {} : { settings: args.settings }),
        });
      }

      for (const op of args.members ?? []) {
        if (op.action === "delete") {
          deleteMember(ctx, requireArg(op.memberId, "memberId"));
          continue;
        }
        if (op.memberId === undefined) {
          createMember(ctx, {
            name: requireArg(op.name, "name"),
            ...(op.notes === undefined ? {} : { notes: op.notes }),
          });
          continue;
        }
        updateMember(ctx, op.memberId, {
          ...(op.name === undefined ? {} : { name: op.name }),
          ...(op.notes === undefined ? {} : { notes: op.notes }),
        });
      }

      return householdState(ctx);
    }),
  );
}
