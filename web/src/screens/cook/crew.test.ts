import { describe, expect, it } from "vitest";
import {
  allDone,
  assignGroup,
  assignedSteps,
  cookIsDone,
  cookNames,
  cookStepAt,
  cooksDone,
  defaultOwners,
  focusCookStep,
  lowestUnfinishedStep,
  moveCook,
  passedSteps,
  setCookPosition,
  stepGroups,
  type Crew,
} from "./crew";

const cooks = [
  { id: "alex", name: "Alex" },
  { id: "sam", name: "Sam" },
];

const grouped = [
  { groupLabel: "Prep" },
  { groupLabel: "Prep" },
  { groupLabel: "Cook" },
  { groupLabel: null },
  { groupLabel: "Cook" },
];

function crew(positions: Record<string, number> = {}): Crew {
  return { cooks, owners: ["alex", "alex", "sam", "alex", "sam"], positions };
}

describe("crew assignment", () => {
  it("gives each group, including ungrouped runs, to the next cook", () => {
    expect(stepGroups(grouped)).toEqual([
      { start: 0, end: 2, label: "Prep" },
      { start: 2, end: 3, label: "Cook" },
      { start: 3, end: 4, label: null },
      { start: 4, end: 5, label: "Cook" },
    ]);
    expect(defaultOwners(grouped, cooks)).toEqual(["alex", "alex", "sam", "alex", "sam"]);
  });

  it("alternates steps when the recipe has no group labels", () => {
    const steps = [{ groupLabel: null }, { groupLabel: null }, { groupLabel: null }];
    expect(defaultOwners(steps, cooks)).toEqual(["alex", "sam", "alex"]);
  });

  it("assigns a whole group from its header chip", () => {
    const owners = ["alex", "alex", "sam", "alex", "sam"];
    expect(assignGroup(owners, grouped, 0, "sam")).toEqual(["sam", "sam", "sam", "alex", "sam"]);
    // A later run with the same label is a separate group.
    expect(assignGroup(owners, grouped, 4, "alex")).toEqual(["alex", "alex", "sam", "alex", "alex"]);
  });
});

describe("crew navigation", () => {
  it("walks each cook through their own steps only", () => {
    const start = crew({ alex: 0, sam: 0 });
    expect(assignedSteps(start.owners, "alex")).toEqual([0, 1, 3]);
    expect(cookStepAt(start.owners, "alex", 0)).toBe(0);

    const one = moveCook(start, "alex", 1);
    expect(one.positions.alex).toBe(1);
    expect(cookStepAt(one.owners, "alex", one.positions.alex ?? 0)).toBe(1);

    const past = setCookPosition(start, "alex", 99);
    expect(past.positions.alex).toBe(3);
    expect(cookIsDone(past, "alex")).toBe(true);
    expect(cookStepAt(past.owners, "alex", past.positions.alex ?? 0)).toBeUndefined();

    const back = moveCook(past, "alex", -1);
    expect(back.positions.alex).toBe(2);
    expect(cookIsDone(back, "alex")).toBe(false);
  });

  it("marks progress and counts the cooks who are done", () => {
    const partial = crew({ alex: 3, sam: 0 });
    expect(passedSteps(partial)).toEqual([true, true, false, true, false]);
    expect(cooksDone(partial)).toBe(1);
    expect(allDone(partial)).toBe(false);
    expect(lowestUnfinishedStep(partial, 5)).toBe(2);

    const finished = crew({ alex: 3, sam: 2 });
    expect(cooksDone(finished)).toBe(2);
    expect(allDone(finished)).toBe(true);
    expect(lowestUnfinishedStep(finished, 5)).toBe(4);
  });

  it("jumps a cook to the timer's step", () => {
    const jumped = focusCookStep(crew({ alex: 0, sam: 0 }), "alex", 3);
    expect(jumped.positions.alex).toBe(2);
  });
});

describe("cook names", () => {
  it("reads as a list", () => {
    expect(cookNames([{ id: "a", name: "Alex" }])).toBe("Alex");
    expect(cookNames(cooks)).toBe("Alex & Sam");
    expect(cookNames([...cooks, { id: "jo", name: "Jo" }])).toBe("Alex, Sam & Jo");
  });
});
