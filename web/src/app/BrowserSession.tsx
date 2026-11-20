import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toApiError } from "../api/errors";
import { Button, Emoji } from "../ui";
import { queryClient } from "./queryClient";
import styles from "./BrowserSession.module.css";

type Session =
  | { authenticated: true; account: { email: string }; household: { id: string; name: string } }
  | { authenticated: false; signupOpen: boolean };

async function readSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch("/auth/session", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Can't reach Rakumi. Try again.");
  return response.json() as Promise<Session>;
}

/** The server's `{ error: { code, message } }` message, or a shape-free fallback. */
async function failureMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const error = toApiError(response.status, body);
  return error.code === "unknown" ? fallback : error.message;
}

/**
 * Keep the app behind a login. Login, signup and logout all end by re-reading
 * `/auth/session`, so there is one source of truth for "who is this".
 */
export function BrowserSession({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      void readSession(controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        setSession(next);
        setError("");
        if (!next.authenticated) {
          void queryClient.cancelQueries().then(() => queryClient.clear());
        }
      }).catch(() => {
        if (!controller.signal.aborted) setError("Can't reach Rakumi. Try again.");
      });
    };
    const unauthorized = () => {
      setSession(undefined);
      void queryClient.cancelQueries().then(() => queryClient.clear());
      check();
    };
    check();
    window.addEventListener("pantrypal:unauthorized", unauthorized);
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      window.removeEventListener("pantrypal:unauthorized", unauthorized);
      window.removeEventListener("focus", check);
    };
  }, [attempt]);

  const reread = () => {
    setSession(undefined);
    setAttempt((n) => n + 1);
  };

  if (!session) {
    return <main className={styles.page}><div className={styles.form}>
      <h1 className={styles.title}>Rakumi</h1>
      <p role={error ? "alert" : "status"}>{error || "Opening your pantry…"}</p>
      {error && <Button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try again</Button>}
    </div></main>;
  }
  if (!session.authenticated) {
    return <AuthForm signupOpen={session.signupOpen} onAuthenticated={reread} />;
  }
  return <>{children}</>;
}

function AuthForm({ signupOpen, onAuthenticated }: { signupOpen: boolean; onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";
  const filled = email.length > 0
    && (signup ? password.length >= 8 && householdName.trim().length > 0 : password.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !filled) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(signup ? "/auth/signup" : "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup ? { email, password, householdName: householdName.trim() } : { email, password }),
      });
      if (!response.ok) {
        setError(await failureMessage(response, signup
          ? "Couldn't create your account. Try again."
          : "Couldn't log in. Try again."));
        return;
      }
      onAuthenticated();
    } catch {
      setError("Can't reach Rakumi. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <Emoji code="relish" size={72} />
      <h1 className={styles.title}>{signup ? "Start your pantry." : "Your pantry awaits."}</h1>
      <p className={styles.hint}>{signup
        ? "Create an account for your household."
        : "Log in with your email to open Rakumi."}</p>
      <label className={styles.label} htmlFor="auth-email">Email</label>
      <input id="auth-email" className={styles.input} type="email" autoComplete="email" autoFocus required
        value={email} onChange={(event) => setEmail(event.target.value)}
        aria-invalid={!!error} aria-describedby={error ? "auth-error" : undefined} />
      <label className={styles.label} htmlFor="auth-password">Password</label>
      <input id="auth-password" className={styles.input} type="password" required
        autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined}
        value={password} onChange={(event) => setPassword(event.target.value)}
        aria-invalid={!!error} aria-describedby={error ? "auth-error" : undefined} />
      {signup && <>
        <label className={styles.label} htmlFor="auth-household">Household name</label>
        <input id="auth-household" className={styles.input} type="text" autoComplete="organization" required
          value={householdName} onChange={(event) => setHouseholdName(event.target.value)}
          aria-invalid={!!error} aria-describedby={error ? "auth-error" : undefined} />
      </>}
      {error && <p id="auth-error" className={styles.error} role="alert">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={!filled || busy}>
        {signup ? "Create account" : "Log in"}
      </Button>
      {signup && <p className={styles.hint}>Use at least 8 characters for your password.</p>}
      <p className={styles.hint}>Stay logged in for 30 days on this device.</p>
      {signupOpen && <Button variant="ghost" onClick={() => { setMode(signup ? "login" : "signup"); setError(""); }}>
        {signup ? "I already have an account" : "New here? Create an account"}
      </Button>}
    </form>
  </main>;
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error();
      // No session any more: the listener in BrowserSession clears the cache and
      // re-reads /auth/session, which swaps the app for the login form.
      window.dispatchEvent(new Event("pantrypal:unauthorized"));
    } catch {
      setError("Couldn't log out. Check your connection and try again.");
      setBusy(false);
    }
  }
  return <div><Button onClick={() => void logout()} loading={busy} disabled={busy}>Log out</Button>
    {error && <p role="alert">{error}</p>}</div>;
}
