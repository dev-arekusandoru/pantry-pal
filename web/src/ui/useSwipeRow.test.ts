import { describe, expect, it } from "vitest";
import { swipeOutcome } from "./useSwipeRow";

describe("swipeOutcome", () => {
  it("commits past 72px and 35% of the row", () => {
    expect(swipeOutcome(72, 200, 0)).toBe("commit");
    expect(swipeOutcome(71, 200, 0)).toBe("cancel");
  });
  it("needs 35% of a wide row", () => {
    expect(swipeOutcome(100, 400, 0)).toBe("cancel");
    expect(swipeOutcome(140, 400, 0)).toBe("commit");
  });
  it("commits on a flick, but not a tiny one", () => {
    expect(swipeOutcome(30, 400, 1)).toBe("commit");
    expect(swipeOutcome(10, 400, 2)).toBe("cancel");
  });
  it("never commits leftward or zero", () => {
    expect(swipeOutcome(-200, 300, 5)).toBe("cancel");
    expect(swipeOutcome(0, 300, 5)).toBe("cancel");
  });
});
