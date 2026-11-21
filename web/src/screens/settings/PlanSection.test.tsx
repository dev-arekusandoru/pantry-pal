import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext, type AuthenticatedSession } from "@/app/session";
import { PlanSection } from "./PlanSection";

afterEach(() => vi.unstubAllGlobals());

function session(over: Partial<AuthenticatedSession>): AuthenticatedSession {
  return {
    authenticated: true,
    account: { email: "a@home.test", emailVerified: true, verifyBy: null },
    household: { id: "h1", name: "Home" },
    features: { email: true, billing: true },
    access: { status: "ok" },
    billing: {
      status: "active", interval: "month", trialEndsAt: null, currentPeriodEnd: "2026-12-05T10:00:00.000Z",
      cancelAtPeriodEnd: false, exempt: false, deleteAt: null, plans: [],
    },
    ...over,
  };
}

function renderPlan(value: AuthenticatedSession) {
  return render(
    <SessionContext.Provider value={{ session: value, refresh: () => undefined }}>
      <PlanSection />
    </SessionContext.Provider>,
  );
}

describe("PlanSection", () => {
  it("shows status, renewal date and email state, and opens the billing portal", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "https://polar.test/portal" })));
    renderPlan(session({}));
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "Plan and billing" })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Renews")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-12-05T10:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }))).toBeInTheDocument();
    expect(screen.getByText("a@home.test is verified")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage billing" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://polar.test/portal"));
  });

  it("says when the email is not verified yet", () => {
    renderPlan(session({ account: { email: "a@home.test", emailVerified: false, verifyBy: "2026-11-28T10:00:00.000Z" } }));
    expect(screen.getByText(/is not verified\. Verify by/)).toBeInTheDocument();
  });

  it("has no plan section on a self-hosted server", () => {
    renderPlan(session({ billing: null, features: { email: false, billing: false } }));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
