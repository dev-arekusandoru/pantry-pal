import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionContext, type AuthenticatedSession } from "@/app/session";
import { SupportSection } from "./SupportSection";

function renderSupport(supportEmail: string | null) {
  const session: AuthenticatedSession = {
    authenticated: true,
    account: { email: "a@home.test", emailVerified: true, verifyBy: null },
    household: { id: "h1", name: "Home" },
    features: { email: true, billing: true },
    supportEmail,
    access: { status: "ok" },
    billing: null,
  };
  return render(
    <SessionContext.Provider value={{ session, refresh: () => undefined }}>
      <SupportSection />
    </SessionContext.Provider>,
  );
}

describe("SupportSection", () => {
  it("links to the support email", () => {
    renderSupport("support@rakumi.app");
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "mailto:support@rakumi.app");
  });

  it("renders nothing when the server has no support email", () => {
    renderSupport(null);
    expect(screen.queryByRole("heading", { name: "Help" })).not.toBeInTheDocument();
  });
});
