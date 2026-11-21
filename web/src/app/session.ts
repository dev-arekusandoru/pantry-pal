import { createContext, useContext } from "react";
import { toApiError } from "../api/errors";

export type Features = { email: boolean; billing: boolean };
export type Plan = { interval: "month" | "year"; price: string };
export type Billing = {
  status: string;
  interval: "month" | "year" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  exempt: boolean;
  deleteAt: string | null;
  plans: Plan[];
};
export type Access =
  | { status: "ok" }
  | { status: "locked"; reason: "subscription_required" | "email_unverified" };
export type AuthenticatedSession = {
  authenticated: true;
  account: { email: string; emailVerified: boolean; verifyBy: string | null };
  household: { id: string; name: string };
  features: Features;
  access: Access;
  billing: Billing | null;
};
export type Session =
  | AuthenticatedSession
  | { authenticated: false; signupOpen: boolean; features: Features };

export const UNREACHABLE = "Can't reach Rakumi. Try again.";

export async function readSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch("/auth/session", { cache: "no-store", signal });
  if (!response.ok) throw new Error(UNREACHABLE);
  return response.json() as Promise<Session>;
}

/** The server's `{ error: { code, message } }` message, or a shape-free fallback. */
export async function failureMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const error = toApiError(response.status, body);
  return error.code === "unknown" ? fallback : error.message;
}

export function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A date in the user's locale, e.g. "28 Nov 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Ask Polar for the customer portal, then leave for it. Returns an error message, or "" when leaving. */
export async function openPortal(): Promise<string> {
  const fallback = "Couldn't open billing. Try again.";
  try {
    const response = await postJson("/billing/portal");
    if (!response.ok) return await failureMessage(response, fallback);
    const body = (await response.json()) as { url: string };
    window.location.assign(body.url);
    return "";
  } catch {
    return UNREACHABLE;
  }
}

/** Send a new verification link. Returns `{ ok }` plus a message for the user. */
export async function resendVerification(): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await postJson("/auth/verify-email/send");
    if (response.status === 429) {
      const wait = Number(response.headers.get("Retry-After"));
      return {
        ok: false,
        message: Number.isFinite(wait) && wait > 0
          ? `Too many requests. Try again in ${wait <= 90 ? `${Math.ceil(wait)} seconds` : `${Math.ceil(wait / 60)} minutes`}.`
          : "Too many requests. Try again later.",
      };
    }
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Couldn't send the link. Try again.") };
    return { ok: true, message: "We sent a new link. Check your email." };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export type SessionContextValue = { session: AuthenticatedSession; refresh: () => void };

export const SessionContext = createContext<SessionContextValue | null>(null);

/** The logged-in session, or null outside `BrowserSession` (tests, storybook). */
export function useSession(): SessionContextValue | null {
  return useContext(SessionContext);
}
