import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Emoji } from "../ui";
import { LogoutButton } from "./LogoutButton";
import {
  UNREACHABLE,
  failureMessage,
  formatDate,
  openPortal,
  postJson,
  readSession,
  resendVerification,
  type AuthenticatedSession,
  type Session,
} from "./session";
import styles from "./BrowserSession.module.css";

/** Move focus to the heading when a screen appears, so screen readers announce the change. */
function useFocusOnMount() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function Screen({ title, children, emoji = "relish" }: { title: string; children: ReactNode; emoji?: "relish" }) {
  const heading = useFocusOnMount();
  return <main className={styles.page}><div className={styles.form}>
    <Emoji code={emoji} size={72} />
    <h1 ref={heading} tabIndex={-1} className={styles.title}>{title}</h1>
    {children}
  </div></main>;
}

function Notice({ message, ok }: { message: string; ok: boolean }) {
  if (!message) return null;
  return <p className={ok ? styles.hint : styles.error} role={ok ? "status" : "alert"}>{message}</p>;
}

type Mode = "login" | "signup" | "forgot";

export function AuthForm({ signupOpen, emailOn, onAuthenticated }: {
  signupOpen: boolean;
  emailOn: boolean;
  onAuthenticated: () => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const filled = email.length > 0
    && (forgot || (signup ? password.length >= 8 && householdName.trim().length > 0 : password.length > 0));

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setSent(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !filled) return;
    setBusy(true);
    setError("");
    try {
      if (forgot) {
        const response = await postJson("/auth/password/forgot", { email });
        if (!response.ok) {
          setError(await failureMessage(response, "Couldn't send the link. Try again."));
          return;
        }
        setSent(true);
        return;
      }
      const response = await postJson(
        signup ? "/auth/signup" : "/auth/login",
        signup ? { email, password, householdName: householdName.trim() } : { email, password },
      );
      if (!response.ok) {
        setError(await failureMessage(response, signup
          ? "Couldn't create your account. Try again."
          : "Couldn't log in. Try again."));
        return;
      }
      onAuthenticated();
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  const described = error ? "auth-error" : undefined;
  return <main className={styles.page}>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <Emoji code="relish" size={72} />
      <h1 className={styles.title}>{forgot ? "Reset your password." : signup ? "Start your pantry." : "Your pantry awaits."}</h1>
      <p className={styles.hint}>{forgot
        ? "Enter your email. We send you a link to choose a new password."
        : signup ? "Create an account for your household." : "Log in with your email to open Rakumi."}</p>
      <label className={styles.label} htmlFor="auth-email">Email</label>
      <input id="auth-email" className={styles.input} type="email" autoComplete="email" autoFocus required
        value={email} onChange={(event) => setEmail(event.target.value)}
        aria-invalid={!!error} aria-describedby={described} />
      {!forgot && <>
        <label className={styles.label} htmlFor="auth-password">Password</label>
        <input id="auth-password" className={styles.input} type="password" required
          autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined}
          value={password} onChange={(event) => setPassword(event.target.value)}
          aria-invalid={!!error} aria-describedby={described} />
      </>}
      {signup && <>
        <label className={styles.label} htmlFor="auth-household">Household name</label>
        <input id="auth-household" className={styles.input} type="text" autoComplete="organization" required
          value={householdName} onChange={(event) => setHouseholdName(event.target.value)}
          aria-invalid={!!error} aria-describedby={described} />
      </>}
      {error && <p id="auth-error" className={styles.error} role="alert">{error}</p>}
      {sent && <p className={styles.hint} role="status">If an account has this email, we sent a link. Check your email.</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={!filled || busy}>
        {forgot ? "Send link" : signup ? "Create account" : "Log in"}
      </Button>
      {signup && <p className={styles.hint}>Use at least 8 characters for your password.</p>}
      {mode === "login" && <p className={styles.hint}>Stay logged in for 30 days on this device.</p>}
      {mode === "login" && emailOn && <Button variant="ghost" onClick={() => switchMode("forgot")}>Forgot password?</Button>}
      {forgot && <Button variant="ghost" onClick={() => switchMode("login")}>Back to log in</Button>}
      {!forgot && signupOpen && <Button variant="ghost" onClick={() => switchMode(signup ? "login" : "signup")}>
        {signup ? "I already have an account" : "New here? Create an account"}
      </Button>}
    </form>
  </main>;
}

/** `/reset-password?token=`: choose a new password. Success starts a session. */
export function ResetPasswordPage({ token, onDone, onCancel }: {
  token: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const heading = useFocusOnMount();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length < 8) return;
    setBusy(true);
    setError("");
    try {
      const response = await postJson("/auth/password/reset", { token, password });
      if (!response.ok) {
        setError(await failureMessage(response, "This link does not work any more. Ask for a new one."));
        return;
      }
      onDone();
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <Emoji code="relish" size={72} />
      <h1 ref={heading} tabIndex={-1} className={styles.title}>Choose a new password.</h1>
      <label className={styles.label} htmlFor="reset-password">New password</label>
      <input id="reset-password" className={styles.input} type="password" autoComplete="new-password"
        required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)}
        aria-invalid={!!error} aria-describedby={error ? "reset-error" : undefined} />
      <p className={styles.hint}>Use at least 8 characters.</p>
      {error && <p id="reset-error" className={styles.error} role="alert">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={password.length < 8 || busy}>
        Save password
      </Button>
      <Button variant="ghost" onClick={onCancel}>Back to log in</Button>
    </form>
  </main>;
}

/** `/verify-email?token=`: confirm the email. Works with or without a session. */
export function VerifyEmailPage({ token, onContinue }: { token: string; onContinue: () => void }) {
  const [state, setState] = useState<{ phase: "working" } | { phase: "done" } | { phase: "failed"; message: string }>(
    { phase: "working" },
  );
  // A token works once. React Strict Mode runs effects twice in dev; post only once.
  const posted = useRef(false);
  useEffect(() => {
    if (posted.current) return;
    posted.current = true;
    void (async () => {
      try {
        const response = await postJson("/auth/verify-email", { token });
        setState(response.ok
          ? { phase: "done" }
          : { phase: "failed", message: await failureMessage(response, "This link does not work any more.") });
      } catch {
        setState({ phase: "failed", message: UNREACHABLE });
      }
    })();
  }, [token]);

  return <Screen title={state.phase === "done" ? "Email verified." : state.phase === "failed" ? "Link did not work." : "Checking your link…"}>
    {state.phase === "failed" && <>
      <p className={styles.error} role="alert">{state.message}</p>
      <p className={styles.hint}>Log in and ask for a new link.</p>
    </>}
    {state.phase === "done" && <p className={styles.hint} role="status">Thank you. Your email is safe with us.</p>}
    {state.phase !== "working" && <Button variant="primary" onClick={onContinue}>Continue</Button>}
  </Screen>;
}

export function ResendLink({ label = "Resend link" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  return <>
    <Button loading={busy} disabled={busy} onClick={() => {
      setBusy(true);
      void resendVerification().then(setResult).finally(() => setBusy(false));
    }}>{label}</Button>
    {result && <Notice ok={result.ok} message={result.message} />}
  </>;
}

export function EmailLockScreen({ email }: { email: string }) {
  return <Screen title="Verify your email">
    <p>You must verify your email to use Rakumi. We sent a link to {email} when you made your account.</p>
    <p>Can't find it? We can send you a new link.</p>
    <ResendLink label="Send a new link" />
    <LogoutButton />
  </Screen>;
}

export function PaywallScreen({ session, onRefresh }: { session: AuthenticatedSession; onRefresh: () => void }) {
  const billing = session.billing;
  const plans = billing?.plans ?? [];
  const status = billing?.status ?? "none";
  const [interval, setInterval] = useState<"month" | "year">(plans[0]?.interval ?? "month");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pastDue = status === "past_due";
  const returning = pastDue || status === "canceled";

  async function go(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setError(await action());
    setBusy(false);
  }

  async function checkout(): Promise<string> {
    try {
      const response = await postJson("/billing/checkout", { interval });
      if (response.status === 409) onRefresh(); // already subscribed: the session read shows the app
      if (!response.ok) return await failureMessage(response, "Couldn't start checkout. Try again.");
      const body = (await response.json()) as { url: string };
      window.location.assign(body.url);
      return "";
    } catch {
      return UNREACHABLE;
    }
  }

  return <Screen title={pastDue ? "Payment failed" : returning ? "Your plan ended" : "Start your 14-day trial"}>
    {pastDue
      ? <p>We could not take your payment. Update your card to open your pantry again.</p>
      : returning
        ? <p>Start a new plan to open your pantry again.</p>
        : <p>Pick a plan to open your pantry.</p>}
    {billing?.deleteAt && billing.status !== "none" && <p className={styles.hint}>
      If you choose not to subscribe, we'll remove your data on {formatDate(billing.deleteAt)}.
    </p>}
    {pastDue
      ? <Button variant="primary" loading={busy} disabled={busy} onClick={() => void go(openPortal)}>Manage billing</Button>
      : <>
        {plans.length > 0 && <fieldset className={styles.plans}>
          <legend className={styles.label}>Plan</legend>
          {plans.map((plan) => <label key={plan.interval} className={styles.plan}>
            <input type="radio" name="plan" value={plan.interval} checked={interval === plan.interval}
              onChange={() => setInterval(plan.interval)} />
            <span>{plan.interval === "year" ? "Every year" : "Every month"}</span>
            <strong>{plan.price}</strong>
          </label>)}
        </fieldset>}
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void go(checkout)}>
          {returning ? "Start again" : "Start my free trial"}
        </Button>
        {!returning && <p className={styles.hint}>
          Card needed. No charge until day 14. Cancel any time. Each person gets one free trial: if you used one before, checkout shows the price you pay today.
        </p>}
      </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!session.account.emailVerified && session.features.email && <div className={styles.hint}>
      <p>We sent a link to {session.account.email} to verify your email.</p>
      <ResendLink />
    </div>}
    <LogoutButton />
  </Screen>;
}

const CHECKOUT_POLL_MS = 2000;
const CHECKOUT_LIMIT_MS = 60_000;

/** After Polar checkout: ask the server to sync, then poll until the lock lifts. */
export function CheckoutReturn({ onDone }: { onDone: (session: Session) => void }) {
  const [timedOut, setTimedOut] = useState(false);
  const [run, setRun] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    setTimedOut(false);
    const controller = new AbortController();
    const deadline = Date.now() + CHECKOUT_LIMIT_MS;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await readSession(controller.signal);
        if (controller.signal.aborted) return;
        // Paid, or locked for another reason (email): the trial itself is set up.
        const waiting = next.authenticated && next.access.status === "locked"
          && next.access.reason === "subscription_required";
        if (!waiting) return done.current(next);
      } catch {
        if (controller.signal.aborted) return;
      }
      if (Date.now() >= deadline) return setTimedOut(true);
      timer = window.setTimeout(() => void poll(), CHECKOUT_POLL_MS);
    };
    void (async () => {
      try { await postJson("/billing/sync"); } catch { /* the poll below still shows the truth */ }
      if (!controller.signal.aborted) void poll();
    })();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [run]);

  if (!timedOut) {
    return <Screen title="Setting up your trial…"><p role="status">This takes a few seconds.</p></Screen>;
  }
  return <Screen title="This takes longer than usual.">
    <p role="alert">We have not heard from the payment service yet. If you paid, your trial starts soon. Try again in a minute.</p>
    <Button variant="primary" onClick={() => setRun((n) => n + 1)}>Try again</Button>
    <LogoutButton />
  </Screen>;
}
