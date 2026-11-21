import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { BrowserSession } from "./BrowserSession";
import { LogoutButton } from "./LogoutButton";
import { client, unwrap } from "../api/client";

const features = { email: true, billing: true };
const signedOut = { authenticated: false, signupOpen: true, features };
const signedIn = {
  authenticated: true,
  account: { email: "a@home.test", emailVerified: true, verifyBy: null },
  household: { id: "h1", name: "Home" },
  features,
  access: { status: "ok" },
  billing: null,
};
const plans = [{ interval: "month", price: "$3.99" }, { interval: "year", price: "$39" }];
const noPlan = {
  status: "none", interval: null, trialEndsAt: null, currentPeriodEnd: null,
  cancelAtPeriodEnd: false, exempt: false, deleteAt: "2026-12-21T10:00:00.000Z", plans,
};
const needsPlan = {
  ...signedIn,
  access: { status: "locked", reason: "subscription_required" },
  billing: noPlan,
};
const assign = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => handler(String(input), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: Mock<typeof fetch>, url: string): unknown {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === url);
  return JSON.parse(String(call?.[1]?.body));
}

beforeEach(() => {
  assign.mockReset();
  // jsdom cannot navigate; read the live URL but record `assign` calls.
  const real = window.location;
  vi.stubGlobal("location", {
    get pathname() { return real.pathname; },
    get search() { return real.search; },
    get href() { return real.href; },
    assign,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("BrowserSession", () => {
  it("logs in with email and password, then shows the app", async () => {
    let authenticated = false;
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(authenticated ? signedIn : signedOut);
      if (url === "/auth/login") {
        authenticated = true;
        return json({ account: signedIn.account, household: signedIn.household });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Email"), "a@home.test");
    await user.type(screen.getByLabelText("Password"), "hunter222");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Pantry is open")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "/auth/login")).toEqual({ email: "a@home.test", password: "hunter222" });
  });

  it("shows the server message when login fails", async () => {
    stubFetch((url) => url === "/auth/session"
      ? json(signedOut)
      : apiError(401, "unauthorized", "Invalid email or password"));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Email"), "a@home.test");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", "auth-error");
    expect(screen.queryByText("Pantry is open")).not.toBeInTheDocument();
  });

  it("creates a household from the signup form", async () => {
    let authenticated = false;
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(authenticated ? signedIn : signedOut);
      if (url === "/auth/signup") {
        authenticated = true;
        return json({ account: signedIn.account, household: signedIn.household }, 201);
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New here? Create an account" }));
    await user.type(screen.getByLabelText("Email"), "a@home.test");
    await user.type(screen.getByLabelText("Password"), "hunter222");
    await user.type(screen.getByLabelText("Household name"), "  Home  ");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Pantry is open")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "/auth/signup")).toEqual({
      email: "a@home.test", password: "hunter222", householdName: "Home",
    });
  });

  it("shows the server message when signup is refused", async () => {
    stubFetch((url) => url === "/auth/session"
      ? json(signedOut)
      : apiError(409, "conflict", "An account with this email already exists"));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New here? Create an account" }));
    await user.type(screen.getByLabelText("Email"), "a@home.test");
    await user.type(screen.getByLabelText("Password"), "hunter222");
    await user.type(screen.getByLabelText("Household name"), "Home");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
  });

  it("hides signup when the server closes it", async () => {
    stubFetch(() => json({ ...signedOut, signupOpen: false }));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create an account/i })).not.toBeInTheDocument();
  });

  it("returns to the login form after logout", async () => {
    let authenticated = true;
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(authenticated ? signedIn : signedOut);
      if (url === "/auth/logout") {
        authenticated = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><LogoutButton /><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("offers password reset only when email is on", async () => {
    stubFetch(() => json({ ...signedOut, features: { email: false, billing: false } }));
    const first = render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forgot password?" })).not.toBeInTheDocument();
    first.unmount();

    stubFetch(() => json(signedOut));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    expect(await screen.findByRole("button", { name: "Forgot password?" })).toBeInTheDocument();
  });

  it("sends the email for a forgotten password without saying if the account exists", async () => {
    const fetchMock = stubFetch((url) => url === "/auth/session" ? json(signedOut) : new Response(null, { status: 204 }));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "a@home.test");
    await user.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("If an account has this email");
    expect(bodyOf(fetchMock, "/auth/password/forgot")).toEqual({ email: "a@home.test" });
  });

  it("sets a new password from the reset link and opens the app", async () => {
    window.history.replaceState(null, "", "/reset-password?token=tok_reset");
    let authenticated = false;
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(authenticated ? signedIn : signedOut);
      if (url === "/auth/password/reset") {
        authenticated = true;
        return json({ account: signedIn.account, household: signedIn.household });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("New password"), "brand-new-pass");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(await screen.findByText("Pantry is open")).toBeInTheDocument();
    expect(bodyOf(fetchMock, "/auth/password/reset")).toEqual({ token: "tok_reset", password: "brand-new-pass" });
    expect(window.location.search).toBe("");
  });

  it("posts the token from a verify link and removes it from the address bar", async () => {
    window.history.replaceState(null, "", "/verify-email?token=tok_verify");
    const fetchMock = stubFetch((url) => url === "/auth/session" ? json(signedOut) : new Response(null, { status: 204 }));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);

    expect(await screen.findByRole("heading", { name: "Email verified." })).toBeInTheDocument();
    expect(bodyOf(fetchMock, "/auth/verify-email")).toEqual({ token: "tok_verify" });
    expect(window.location.href).not.toContain("tok_verify");
  });

  it("says when a verify link does not work", async () => {
    window.history.replaceState(null, "", "/verify-email?token=old");
    stubFetch(() => apiError(400, "invalid_token", "This link has expired"));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);

    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired");
  });

  it("shows the paywall when the household is locked and goes to checkout", async () => {
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(needsPlan);
      if (url === "/billing/checkout") return json({ url: "https://polar.test/pay" });
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Start your 14-day trial" })).toBeInTheDocument();
    expect(screen.getByText(/No charge until day 14/)).toBeInTheDocument();
    // A new user who never subscribed is not warned about deletion on the paywall.
    expect(screen.queryByText(/we delete your household on/)).not.toBeInTheDocument();
    expect(screen.queryByText("Pantry is open")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Every year/ }));
    await user.click(screen.getByRole("button", { name: "Start my free trial" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://polar.test/pay"));
    expect(bodyOf(fetchMock, "/billing/checkout")).toEqual({ interval: "year" });
  });

  it("sends a user with a failed payment to the billing portal", async () => {
    stubFetch((url) => {
      if (url === "/auth/session") {
        return json({ ...needsPlan, billing: { ...noPlan, status: "past_due" } });
      }
      if (url === "/billing/portal") return json({ url: "https://polar.test/portal" });
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Payment failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start my free trial" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage billing" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://polar.test/portal"));
  });

  it("offers a new plan after one ended", async () => {
    stubFetch(() => json({ ...needsPlan, billing: { ...noPlan, status: "canceled" } }));
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);

    expect(await screen.findByRole("heading", { name: "Your plan ended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });

  it("syncs after checkout, waits for the lock to lift, then shows the app", async () => {
    window.history.replaceState(null, "", "/?checkout=chk_1");
    let synced = false;
    const fetchMock = stubFetch((url) => {
      if (url === "/billing/sync") {
        synced = true;
        return new Response(null, { status: 204 });
      }
      if (url === "/auth/session") return json(synced ? signedIn : needsPlan);
      throw new Error(`unexpected ${url}`);
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);

    expect(await screen.findByText("Pantry is open")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/billing/sync", expect.objectContaining({ method: "POST" }));
    expect(window.location.search).toBe("");
  });

  it("locks the app with the verify screen and explains a resend limit", async () => {
    stubFetch((url) => {
      if (url === "/auth/session") {
        return json({ ...signedIn, access: { status: "locked", reason: "email_unverified" } });
      }
      return new Response(null, { status: 429, headers: { "Retry-After": "45" } });
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send a new link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 45 seconds");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("re-reads the session when the API answers 402 and shows the paywall", async () => {
    let locked = false;
    const fetchMock = stubFetch((url) => {
      if (url === "/auth/session") return json(locked ? needsPlan : signedIn);
      locked = true;
      return apiError(402, "subscription_required", "Your plan ended");
    });
    render(<BrowserSession><p>Pantry is open</p></BrowserSession>);
    expect(await screen.findByText("Pantry is open")).toBeInTheDocument();

    await unwrap(client.GET("/household")).catch(() => undefined);

    expect(await screen.findByRole("heading", { name: "Start your 14-day trial" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/auth/session").length).toBeGreaterThan(1);
  });
});
