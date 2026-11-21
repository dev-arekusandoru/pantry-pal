import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui";
import { queryClient } from "./queryClient";
import {
  AuthForm,
  CheckoutReturn,
  EmailLockScreen,
  PaywallScreen,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./AccountScreens";
import { SessionContext, UNREACHABLE, readSession, type Session } from "./session";
import styles from "./BrowserSession.module.css";

type EmailLink = { kind: "verify" | "reset"; token: string };

/** The `/verify-email?token=` or `/reset-password?token=` page the user opened from an email. */
function readEmailLink(): EmailLink | null {
  const { pathname, search } = window.location;
  const kind = pathname === "/verify-email" ? "verify" : pathname === "/reset-password" ? "reset" : null;
  const token = new URLSearchParams(search).get("token");
  return kind && token ? { kind, token } : null;
}

/** Rewrite the address bar and tell the router, which only listens for `popstate`. */
function replaceUrl(url: string) {
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function readCheckoutReturn(): boolean {
  return new URLSearchParams(window.location.search).has("checkout") && !readEmailLink();
}

/**
 * Keep the app behind a login. Login, signup and logout all end by re-reading
 * `/auth/session`, so there is one source of truth for "who is this".
 */
export function BrowserSession({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [link, setLink] = useState(readEmailLink);
  const [checkout, setCheckout] = useState(readCheckoutReturn);

  // The token is single use and secret: keep it out of history and the address bar.
  useEffect(() => {
    if (link) window.history.replaceState(null, "", "/");
  }, [link]);

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
        if (!controller.signal.aborted) setError(UNREACHABLE);
      });
    };
    const unauthorized = () => {
      setSession(undefined);
      void queryClient.cancelQueries().then(() => queryClient.clear());
      check();
    };
    check();
    window.addEventListener("pantrypal:unauthorized", unauthorized);
    // A 402 means the lock changed. Re-read quietly; the lock screen replaces the app.
    window.addEventListener("pantrypal:payment-required", check);
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      window.removeEventListener("pantrypal:unauthorized", unauthorized);
      window.removeEventListener("pantrypal:payment-required", check);
      window.removeEventListener("focus", check);
    };
  }, [attempt]);

  const reread = () => {
    setSession(undefined);
    setAttempt((n) => n + 1);
  };
  const refresh = () => setAttempt((n) => n + 1);
  const leaveLink = () => {
    setLink(null);
    replaceUrl("/");
    reread();
  };
  const finishCheckout = (next: Session) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("checkout");
    // Polar appends a customer portal token; keep it out of history and screenshots.
    params.delete("customer_session_token");
    const query = params.toString();
    replaceUrl(window.location.pathname + (query ? `?${query}` : ""));
    setCheckout(false);
    setSession(next);
  };

  if (link?.kind === "verify") return <VerifyEmailPage token={link.token} onContinue={leaveLink} />;
  if (link?.kind === "reset") return <ResetPasswordPage token={link.token} onDone={leaveLink} onCancel={leaveLink} />;

  if (!session) {
    return <main className={styles.page}><div className={styles.form}>
      <h1 className={styles.title}>Rakumi</h1>
      <p role={error ? "alert" : "status"}>{error || "Opening your pantry…"}</p>
      {error && <Button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try again</Button>}
    </div></main>;
  }
  if (!session.authenticated) {
    return <AuthForm signupOpen={session.signupOpen} emailOn={session.features.email} onAuthenticated={reread} />;
  }
  if (checkout) return <CheckoutReturn onDone={finishCheckout} />;
  if (session.access.status === "locked") {
    return session.access.reason === "email_unverified"
      ? <EmailLockScreen email={session.account.email} />
      : <PaywallScreen session={session} onRefresh={refresh} />;
  }
  return <SessionContext.Provider value={{ session, refresh }}>{children}</SessionContext.Provider>;
}
