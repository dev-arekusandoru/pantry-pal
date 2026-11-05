import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button, Sheet, Stepper } from ".";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pick a recipe">
        <input aria-label="Search" />
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("opens as a labelled dialog, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Pick a recipe" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const backdrop = screen.getByRole("dialog").previousElementSibling as HTMLElement;
    await user.click(backdrop);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps a visually hidden title as the accessible name", () => {
    render(
      <Sheet open onClose={() => {}} title="Hidden title" hideTitle>
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Hidden title" })).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  it("calls back and labels buttons", async () => {
    const user = userEvent.setup();
    let n = 2;
    render(<Stepper label="Servings" value={n} onDecrement={() => n--} onIncrement={() => n++} />);
    await user.click(screen.getByRole("button", { name: "Increase servings" }));
    await user.click(screen.getByRole("button", { name: "Decrease servings" }));
    await user.click(screen.getByRole("button", { name: "Decrease servings" }));
    expect(n).toBe(1);
  });
});
