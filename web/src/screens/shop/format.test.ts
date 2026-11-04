import { describe, expect, it } from "vitest";
import { formatAmount, formatQty, parseQty, unitLabel } from "./format";

describe("formatQty", () => {
  it("uses fraction glyphs near common fractions", () => {
    expect(formatQty(1.5)).toBe("1½");
    expect(formatQty(0.25)).toBe("¼");
    expect(formatQty(2 / 3)).toBe("⅔");
    expect(formatQty(2)).toBe("2");
    expect(formatQty(1.999)).toBe("2");
  });
  it("falls back to two decimals", () => {
    expect(formatQty(0.43)).toBe("0.43");
  });
});

describe("parseQty", () => {
  it("reads decimals, comma decimals and fractions", () => {
    expect(parseQty("2")).toBe(2);
    expect(parseQty("1.5")).toBe(1.5);
    expect(parseQty("1,5")).toBe(1.5);
    expect(parseQty(".5")).toBe(0.5);
    expect(parseQty("1/2")).toBe(0.5);
    expect(parseQty("1 1/2")).toBe(1.5);
  });
  it("rejects junk, negatives and zero denominators", () => {
    expect(parseQty("")).toBeNull();
    expect(parseQty("abc")).toBeNull();
    expect(parseQty("-1")).toBeNull();
    expect(parseQty("1/0")).toBeNull();
  });
});

describe("amounts", () => {
  it("pluralizes packaging units above one and hides count", () => {
    expect(formatAmount(3, "can")).toBe("3 cans");
    expect(formatAmount(1, "can")).toBe("1 can");
    expect(formatAmount(0.5, "cup")).toBe("½ cup");
    expect(formatAmount(2.5, "cup")).toBe("2½ cups");
    expect(formatAmount(4, "count")).toBe("4");
    expect(formatAmount(null, "lb")).toBe("");
    expect(unitLabel("fl_oz", 2)).toBe("fl oz");
  });
});
