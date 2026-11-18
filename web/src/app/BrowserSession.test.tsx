import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { BrowserSession, LogoutButton } from "./BrowserSession";

const signedOut = { authenticated: false, signupOpen: true };
const signedIn = { authenticated: true, account: { email: "a@home.test" }, household: { id: "h1", name: "Home" } };

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

afterEach(() => vi.unstubAllGlobals());

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
    stubFetch(() => json({ authenticated: false, signupOpen: false }));
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
});
