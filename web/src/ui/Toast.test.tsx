import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast, ToastHost } from ".";

describe("Toast", () => {
  const ids = new Set<number>();
  afterEach(() => {
    act(() => {
      for (const id of ids) toast.dismiss(id);
      ids.clear();
    });
  });

  it("shows a toast imperatively and dismisses it", async () => {
    render(<ToastHost />);
    let id = 0;
    act(() => {
      id = toast.show({ message: "Saved" });
      ids.add(id);
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    act(() => toast.dismiss(id));
    // The toast stays mounted for its exit animation, then unmounts.
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument());
  });

  it("runs an action and dismisses afterwards", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ToastHost />);
    act(() => {
      ids.add(toast.show({ message: "Item deleted", action: { label: "Undo", onClick } }));
    });
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Item deleted")).not.toBeInTheDocument());
  });
});
