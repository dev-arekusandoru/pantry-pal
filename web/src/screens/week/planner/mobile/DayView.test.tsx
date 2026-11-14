import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Draft } from "../draft";
import { DayPlanner } from "./DayView";

const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const today = days[2]!;

function draftWithChili(): Draft {
  return {
    weekStart: days[0]!,
    days,
    batches: [
      {
        id: "b1",
        recipeId: "r1",
        title: "Chili",
        cookDate: days[0]!,
        servings: 4,
        servingsSet: false,
        hue: 0,
        eats: [{ id: "e1", date: days[0]!, mealType: "dinner", servings: null }],
      },
    ],
    notes: [],
  };
}

function Harness({ initial }: { initial: Draft }) {
  const [draft, setDraft] = useState(initial);
  return <DayPlanner draft={draft} setDraft={setDraft} recipes={new Map()} today={today} />;
}

describe("mobile day planner", () => {
  it("shows filled days, the cooking strip and the day's meals", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draftWithChili()} />);
    expect(screen.getByRole("button", { name: /^Monday Nov 9, 1 planned/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Monday Nov 9, 1 planned/ }));
    expect(screen.getByText("Cooking today")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Monday");
    expect(screen.getByRole("button", { name: /^Add lunch/ })).toBeInTheDocument();
  });

  it("places a freeform note from the recipe sheet", async () => {
    const user = userEvent.setup();
    render(<Harness initial={draftWithChili()} />);
    await user.click(screen.getByRole("button", { name: /^Add lunch/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eat out" }));
    expect(await screen.findByText("Eat out")).toBeInTheDocument();
    // The quiet detail lives in the remove label now.
    expect(screen.getByRole("button", { name: /^Remove Eat out from Wednesday Lunch/ })).toHaveAccessibleName(/\(not cooking\)/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
