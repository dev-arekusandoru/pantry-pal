import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from ".";

const OPTIONS = [
  { value: "pantry", label: "Pantry" },
  { value: "freezer", label: "Freezer" },
];

describe("SegmentedControl", () => {
  it("marks exactly one chip selected and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Location" options={OPTIONS} value="pantry" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Pantry" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Freezer" }));
    expect(onChange).toHaveBeenCalledWith("freezer");
  });

  it("does not let the selected chip be deselected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl label="Location" options={OPTIONS} value="pantry" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Pantry" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
