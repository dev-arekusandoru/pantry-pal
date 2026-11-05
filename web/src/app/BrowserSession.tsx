import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Emoji } from "../ui";
import { queryClient } from "./queryClient";
import styles from "./BrowserSession.module.css";

interface Session { enabled: boolean; authenticated: boolean }
const SessionContext = createContext<{ enabled: boolean }>({ enabled: false });

async function readSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch("/auth/session", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Can't reach PantryPal. Try again.");
  return response.json() as Promise<Session>;
}

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
        if (next.enabled && !next.authenticated) {
          void queryClient.cancelQueries().then(() => queryClient.clear());
        }
      }).catch(() => {
        if (!controller.signal.aborted) setError("Can't reach PantryPal. Try again.");
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

  if (!session) {
    return <main className={styles.page}><div className={styles.form}>
      <h1 className={styles.title}>PantryPal</h1>
      <p role={error ? "alert" : "status"}>{error || "Opening your pantry…"}</p>
      {error && <Button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try again</Button>}
    </div></main>;
  }
  if (session.enabled && !session.authenticated) {
    return <Login onLogin={() => {
      // A full navigation also discards router loaders and any component-local data.
      window.location.replace(window.location.pathname === "/login" ? "/" : window.location.href);
    }} />;
  }
  return <SessionContext.Provider value={{ enabled: session.enabled }}>{children}</SessionContext.Provider>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "Incorrect password. Try again." : response.status === 429
          ? "Too many attempts. Wait a few minutes before trying again." : "Couldn't log in. Try again.");
        return;
      }
      onLogin();
    } catch {
      setError("Can't reach PantryPal. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return <main className={styles.page}>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <Emoji code="1FAD9" size={72} />
      <h1 className={styles.title}>Your pantry awaits.</h1>
      <p className={styles.hint}>Enter your household password to open PantryPal.</p>
      <label className={styles.label} htmlFor="pantry-password">Password</label>
      <input id="pantry-password" className={styles.input} type="password" autoComplete="current-password"
        autoFocus required value={password} onChange={(event) => setPassword(event.target.value)}
        aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
      {error && <p id="login-error" className={styles.error} role="alert">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={!password || busy}>Open pantry</Button>
      <p className={styles.hint}>Stay logged in for 30 days on this device.</p>
    </form>
  </main>;
}

export function LogoutButton() {
  const { enabled } = useContext(SessionContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!enabled) return null;
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error();
      await queryClient.cancelQueries();
      queryClient.clear();
      window.location.replace("/login");
    } catch {
      setError("Couldn't log out. Check your connection and try again.");
      setBusy(false);
    }
  }
  return <div><Button onClick={() => void logout()} loading={busy} disabled={busy}>Log out</Button>
    {error && <p role="alert">{error}</p>}</div>;
}
