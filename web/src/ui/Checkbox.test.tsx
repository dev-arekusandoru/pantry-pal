import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from ".";

describe("Checkbox", () => {
  it("exposes a labelled checkbox and reports the new state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox checked={false} onChange={onChange}>
        Flour
      </Checkbox>,
    );
    await user.click(screen.getByRole("checkbox", { name: "Flour" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles from the visible label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox checked onChange={onChange}>
        Flour
      </Checkbox>,
    );
    await user.click(screen.getByText("Flour"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("keeps the boolean contract for box-only checkboxes", () => {
    render(<Checkbox checked onChange={() => {}} aria-label="Got it" />);
    expect(screen.getByRole("checkbox", { name: "Got it" })).toHaveAttribute("aria-checked", "true");
  });
});
