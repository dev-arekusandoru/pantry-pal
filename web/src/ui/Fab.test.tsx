import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Fab } from ".";

describe("Fab", () => {
  it("renders a labelled action button and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Fab label="Add to the pantry" onClick={onClick} />);
    const fab = screen.getByRole("button", { name: "Add to the pantry" });
    await user.click(fab);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows its label as text when extended", () => {
    render(<Fab label="Add an item" showLabel />);
    expect(screen.getByRole("button", { name: "Add an item" })).toHaveTextContent("Add an item");
  });
});
